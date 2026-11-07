import json
from datetime import timedelta
from unittest import mock

from django.test import TestCase
from django.utils import timezone

from apps.ai_companion import services, streaming
from apps.ai_companion.gemini_client import (
    GeminiQuotaError,
    GeminiTruncatedError,
    GeminiUnavailableError,
)
from apps.ai_companion.models import ReflectionChat, ReflectionMessage
from apps.ai_companion.tests.fakes import SEED, FakeGemini, make_profile, make_session, parse_sse
from apps.reading_sessions.models import ReadingSession

START = "/api/v1/companion/start/"
RESTORE = "/api/v1/profile/sync/restore/"
Status = ReadingSession.SessionStatus


def message_url(chat_id):
    return f"/api/v1/companion/{chat_id}/message/"


class CompanionTestCase(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.profile = make_profile()
        cls.other = make_profile()
        cls.session = make_session(cls.profile)

    def headers(self, profile=None):
        return {"HTTP_X_PROFILE_ID": str((profile or self.profile).id)}

    def start(self, session=None, profile=None):
        body = {"session_id": str((session or self.session).id)}
        return self.client.post(
            START, body, content_type="application/json", **self.headers(profile)
        )

    def new_chat(self):
        return ReflectionChat.objects.get(pk=self.start().json()["chat_id"])

    def send(self, chat_id, content="Me quedo con la escena del rio.", profile=None, **extra):
        body = {"content": content, **extra}
        return self.client.post(
            message_url(chat_id), body, content_type="application/json", **self.headers(profile)
        )

    def converse(self, chat, fake, content="Me quedo con la escena del rio.", **extra):
        with mock.patch("apps.ai_companion.streaming.get_gemini_client", return_value=fake):
            response = self.send(chat.id, content, **extra)
            if response.streaming:  # el generador es perezoso: consumirlo dentro del parche
                response.sse_events = parse_sse(response)
            return response


class StartTests(CompanionTestCase):
    def test_requires_the_profile_header(self):
        self.assertEqual(
            self.client.post(START, {}, content_type="application/json").status_code, 401
        )

    def test_creates_the_chat_with_the_local_turn_1_and_no_gemini_call(self):
        with mock.patch("apps.ai_companion.streaming.get_gemini_client") as client:
            response = self.start()
        client.assert_not_called()
        self.assertEqual(response.status_code, 201)
        data = response.json()
        self.assertEqual(
            (data["turn_count"], data["is_closed"], data["key_takeaway"]), (1, False, None)
        )
        self.assertEqual(len(data["messages"]), 1)
        opening = data["messages"][0]
        self.assertEqual((opening["sender"], opening["turn_number"]), ("KOMI_AI", 1))
        self.assertIn("Kokoro", opening["content"])

    def test_starting_twice_returns_the_same_chat(self):
        first = self.start().json()
        second = self.start()
        self.assertEqual(second.status_code, 200)
        self.assertEqual(second.json()["chat_id"], first["chat_id"])
        self.assertEqual(ReflectionChat.objects.count(), 1)
        self.assertEqual(ReflectionMessage.objects.count(), 1)

    def test_a_missing_or_foreign_session_is_404(self):
        self.assertEqual(self.start(profile=self.other).status_code, 404)
        body = {"session_id": "6f1d5c2e-0000-4000-8000-000000000000"}
        response = self.client.post(START, body, content_type="application/json", **self.headers())
        self.assertEqual(response.status_code, 404)
        self.assertEqual(ReflectionChat.objects.count(), 0)

    def test_an_invalidated_session_has_no_chat(self):
        invalid = make_session(self.profile, status=Status.INVALIDATED_GRACE_EXPIRED)
        response = self.start(session=invalid)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "session_invalid")

    def test_a_malformed_session_id_is_400(self):
        response = self.client.post(
            START, {"session_id": "no-es-uuid"}, content_type="application/json", **self.headers()
        )
        self.assertEqual(response.status_code, 400)


class MessageTests(CompanionTestCase):
    def test_streams_chunks_then_done_and_saves_both_messages(self):
        chat = self.new_chat()
        fake = FakeGemini("Esa escena tiene mucha calma.")
        response = self.converse(chat, fake)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response["Content-Type"].startswith("text/event-stream"))
        self.assertEqual(response["Cache-Control"], "no-cache")
        events = parse_sse(response)
        names = [name for name, _ in events]
        self.assertEqual(names[-1], "done")
        self.assertEqual(set(names[:-1]), {"chunk"})
        streamed = "".join(data["text"] for name, data in events if name == "chunk")
        done = events[-1][1]
        self.assertEqual(streamed, "Esa escena tiene mucha calma.")
        self.assertEqual(done["content"], streamed)
        self.assertEqual((done["turn"], done["is_closed"], done["key_takeaway"]), (2, False, None))
        chat.refresh_from_db()
        self.assertEqual((chat.turn_count, chat.pending_since), (2, None))
        saved = list(chat.messages.values_list("sender", "turn_number", "content"))
        self.assertEqual(
            saved,
            [
                ("KOMI_AI", 1, chat.messages.first().content),
                ("USER", 1, "Me quedo con la escena del rio."),
                ("KOMI_AI", 2, "Esa escena tiene mucha calma."),
            ],
        )

    def test_the_history_sent_to_gemini_ends_with_the_readers_message(self):
        chat = self.new_chat()
        fake = FakeGemini()
        self.converse(chat, fake, content="Hola Komi")
        history = fake.calls[0]["history"]
        self.assertEqual([sender for sender, _ in history], ["KOMI_AI", "USER"])
        self.assertEqual(history[-1][1], "Hola Komi")
        self.assertFalse(fake.calls[0]["extract_seed"])

    def test_the_prompt_is_built_for_the_turn_komi_is_about_to_write(self):
        from apps.ai_companion.prompt_builder import build_komi_system_prompt

        chat = self.new_chat()
        fake = FakeGemini()
        self.converse(chat, fake)
        self.converse(chat, fake)
        for call, turn in zip(fake.calls, (2, 3), strict=True):
            expected = build_komi_system_prompt(self.session, self.profile, turn)
            self.assertEqual(call["prompt"], expected)
        self.assertNotEqual(fake.calls[0]["prompt"], fake.calls[1]["prompt"])

    def test_a_foreign_or_unknown_chat_is_404_without_calling_gemini(self):
        chat = self.new_chat()
        fake = FakeGemini()
        with mock.patch("apps.ai_companion.streaming.get_gemini_client", return_value=fake):
            self.assertEqual(self.send(chat.id, profile=self.other).status_code, 404)
            unknown = self.send("6f1d5c2e-0000-4000-8000-000000000000")
            self.assertEqual(unknown.status_code, 404)
        self.assertEqual(fake.calls, [])
        chat.refresh_from_db()
        self.assertIsNone(chat.pending_since)

    def test_invalid_content_is_400_and_does_not_reserve_the_chat(self):
        chat = self.new_chat()
        fake = FakeGemini()
        for content in ("", "   ", "x" * 2001):
            with self.subTest(length=len(content)):
                self.assertEqual(self.converse(chat, fake, content).status_code, 400)
        missing = self.client.post(
            message_url(chat.id), {}, content_type="application/json", **self.headers()
        )
        self.assertEqual(missing.status_code, 400)
        self.assertEqual(fake.calls, [])
        chat.refresh_from_db()
        self.assertIsNone(chat.pending_since)

    def test_content_of_exactly_2000_characters_is_accepted(self):
        chat = self.new_chat()
        response = self.converse(chat, FakeGemini(), "x" * 2000)
        self.assertEqual(parse_sse(response)[-1][0], "done")

    def test_a_turn_that_does_not_match_the_chat_is_409(self):
        chat = self.new_chat()
        fake = FakeGemini()
        response = self.converse(chat, fake, turn=2)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "turn_mismatch")
        self.assertEqual(fake.calls, [])

    def test_a_matching_turn_is_accepted(self):
        chat = self.new_chat()
        response = self.converse(chat, FakeGemini(), turn=1)
        self.assertEqual(parse_sse(response)[-1][0], "done")

    def test_a_retry_of_an_already_answered_turn_is_409_and_saves_nothing_twice(self):
        chat = self.new_chat()
        self.converse(chat, FakeGemini(), turn=1)
        fake = FakeGemini()
        retry = self.converse(chat, fake, turn=1)
        self.assertEqual(retry.status_code, 409)
        self.assertEqual(fake.calls, [])
        self.assertEqual(chat.messages.count(), 3)

    def test_only_get_is_not_available_for_message(self):
        chat = self.new_chat()
        self.assertEqual(self.client.get(message_url(chat.id), **self.headers()).status_code, 405)

    def test_an_event_stream_accept_header_is_not_rejected(self):
        chat = self.new_chat()
        with mock.patch("apps.ai_companion.streaming.get_gemini_client", return_value=FakeGemini()):
            response = self.client.post(
                message_url(chat.id),
                {"content": "hola"},
                content_type="application/json",
                HTTP_ACCEPT="text/event-stream",
                **self.headers(),
            )
            events = parse_sse(response)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(events[-1][0], "done")


class FailureTests(CompanionTestCase):
    """Con cualquier fallo no se guarda nada, turn_count no sube y se envia un evento error."""

    def assert_nothing_saved(self, chat):
        chat.refresh_from_db()
        self.assertEqual(chat.turn_count, 1)
        self.assertFalse(chat.is_closed)
        self.assertIsNone(chat.key_takeaway)
        self.assertIsNone(chat.pending_since)
        self.assertEqual(chat.messages.count(), 1)

    def failing(self, failure, expected_code, retry_after=None):
        chat = self.new_chat()
        events = parse_sse(self.converse(chat, FakeGemini(failure)))
        self.assertEqual(events[-1][0], "error")
        self.assertEqual(events[-1][1], {"code": expected_code, "retry_after": retry_after})
        self.assertNotIn("done", [name for name, _ in events])
        self.assert_nothing_saved(chat)
        return chat

    def test_a_truncated_answer_is_not_saved_and_does_not_close_the_chat(self):
        self.failing(GeminiTruncatedError("cortada"), "truncated")

    def test_a_truncated_answer_on_the_last_turn_does_not_close_the_chat(self):
        chat = self.new_chat()
        ReflectionChat.objects.filter(pk=chat.pk).update(turn_count=4)
        events = parse_sse(self.converse(chat, FakeGemini(GeminiTruncatedError("cortada"))))
        self.assertEqual(events[-1][1]["code"], "truncated")
        chat.refresh_from_db()
        self.assertEqual((chat.turn_count, chat.is_closed, chat.key_takeaway), (4, False, None))
        self.assertEqual(chat.messages.count(), 1)

    def test_quota_exhausted_reports_the_wait(self):
        self.failing(GeminiQuotaError(retry_after=12.7), "quota_exceeded", retry_after=12)

    def test_quota_without_a_wait_hint(self):
        self.failing(GeminiQuotaError(), "quota_exceeded")

    def test_an_unavailable_gemini_is_reported(self):
        self.failing(GeminiUnavailableError("sin red"), "unavailable")

    def test_an_unexpected_error_is_reported_without_leaking_details(self):
        chat = self.new_chat()
        events = parse_sse(self.converse(chat, FakeGemini(RuntimeError("detalle interno"))))
        self.assertEqual(events[-1], ("error", {"code": "internal", "retry_after": None}))
        self.assertNotIn("detalle interno", json.dumps(events))
        self.assert_nothing_saved(chat)

    def test_an_empty_answer_is_not_saved(self):
        chat = self.new_chat()
        events = parse_sse(self.converse(chat, FakeGemini("   ")))
        self.assertEqual(events[-1][1]["code"], "unavailable")
        self.assert_nothing_saved(chat)

    def test_a_missing_api_configuration_is_reported_as_unavailable(self):
        from django.core.exceptions import ImproperlyConfigured

        chat = self.new_chat()
        with mock.patch(
            "apps.ai_companion.streaming.get_gemini_client", side_effect=ImproperlyConfigured("x")
        ):
            events = parse_sse(self.send(chat.id))
        self.assertEqual(events[-1][1]["code"], "unavailable")
        self.assert_nothing_saved(chat)

    def test_a_missing_model_variable_is_named_in_the_log_but_not_sent_to_the_client(self):
        from django.test import override_settings

        from apps.ai_companion.gemini_client import get_gemini_client

        chat = self.new_chat()
        get_gemini_client.cache_clear()
        try:
            with (
                override_settings(
                    GEMINI_API_KEY="clave-secreta",
                    GEMINI_PRIMARY_MODEL="",
                    GEMINI_FALLBACK_MODEL="respaldo",
                ),
                self.assertLogs("apps.ai_companion.streaming", level="ERROR") as logs,
            ):
                events = parse_sse(self.send(chat.id))
        finally:
            get_gemini_client.cache_clear()
        self.assertEqual(events[-1], ("error", {"code": "unavailable", "retry_after": None}))
        log_text = " | ".join(logs.output)
        self.assertIn("GEMINI_PRIMARY_MODEL", log_text)
        self.assertNotIn("GEMINI_FALLBACK_MODEL", log_text)
        self.assertNotIn("clave-secreta", log_text + json.dumps(events))
        self.assertNotIn("GEMINI_PRIMARY_MODEL", json.dumps(events))
        self.assert_nothing_saved(chat)

    def test_a_stream_that_hangs_times_out_without_saving(self):
        chat = self.new_chat()
        with mock.patch.object(streaming, "STREAM_TIMEOUT_SEC", 0.05):
            events = parse_sse(self.converse(chat, FakeGemini("hang")))
        self.assertEqual(events[-1][1]["code"], "timeout")
        self.assert_nothing_saved(chat)

    def real_client(self, behavior):
        from types import SimpleNamespace

        from apps.ai_companion.gemini_client import GeminiClient

        class Models:
            def __init__(self):
                self.calls = []

            async def generate_content_stream(self, *, model, contents, config=None):
                self.calls.append(model)
                return await behavior(model)

        models = Models()
        client = GeminiClient(
            client=SimpleNamespace(aio=SimpleNamespace(models=models)),
            primary_model="principal",
            fallback_model="respaldo",
        )
        return client, models

    def test_both_models_failing_gives_one_error_releases_the_lock_and_keeps_the_turn(self):
        async def behavior(model):
            raise RuntimeError("Event loop is closed")

        client, models = self.real_client(behavior)
        chat = self.new_chat()
        events = parse_sse(self.converse(chat, client))
        self.assertEqual(models.calls, ["principal", "respaldo"])
        self.assertEqual([name for name, _ in events if name == "error"], ["error"])
        self.assertEqual(events[-1], ("error", {"code": "unavailable", "retry_after": None}))
        self.assertNotIn("done", [name for name, _ in events])
        self.assert_nothing_saved(chat)

    def test_an_early_failure_of_the_primary_is_answered_by_the_fallback_in_one_request(self):
        from types import SimpleNamespace

        async def behavior(model):
            if model == "principal":
                raise RuntimeError("Event loop is closed")

            async def items():
                yield SimpleNamespace(text="Respuesta del respaldo.")

            return items()

        client, models = self.real_client(behavior)
        chat = self.new_chat()
        events = parse_sse(self.converse(chat, client))
        self.assertEqual(models.calls, ["principal", "respaldo"])
        self.assertEqual(events[-1][0], "done")
        chat.refresh_from_db()
        self.assertEqual((chat.turn_count, chat.pending_since), (2, None))

    def test_the_reader_can_retry_the_same_message_after_a_failure(self):
        chat = self.new_chat()
        self.converse(chat, FakeGemini(GeminiUnavailableError("sin red")))
        events = parse_sse(self.converse(chat, FakeGemini("Ahora si."), turn=1))
        self.assertEqual(events[-1][0], "done")
        chat.refresh_from_db()
        self.assertEqual(chat.turn_count, 2)
        self.assertEqual(chat.messages.filter(sender="USER").count(), 1)

    def test_nothing_is_logged_with_the_readers_text_or_komis_answer(self):
        chat = self.new_chat()
        with self.assertLogs("apps.ai_companion", level="DEBUG") as logs:
            self.converse(
                chat, FakeGemini(GeminiUnavailableError("fallo")), content="secreto del lector"
            )
        self.assertNotIn("secreto del lector", "\n".join(logs.output))
        self.assertNotIn("Texto parcial", "\n".join(logs.output))


class LimitTests(CompanionTestCase):
    def full_conversation(self, fake):
        chat = self.new_chat()
        results = []
        for turn in range(1, 5):
            results.append(parse_sse(self.converse(chat, fake, f"Respuesta {turn}", turn=turn)))
        chat.refresh_from_db()
        return chat, results

    def test_a_full_chat_makes_exactly_four_gemini_calls(self):
        fake = FakeGemini("Uno.", "Dos.", "Tres.", "Cierre sereno.")
        chat, results = self.full_conversation(fake)
        self.assertEqual(len(fake.calls), 4)
        self.assertEqual([call["extract_seed"] for call in fake.calls], [False, False, False, True])
        self.assertEqual([events[-1][0] for events in results], ["done"] * 4)
        self.assertEqual((chat.turn_count, chat.is_closed), (5, True))
        self.assertEqual(chat.key_takeaway, SEED)

    def test_the_conversation_is_stored_in_order(self):
        chat, _ = self.full_conversation(FakeGemini("Uno.", "Dos.", "Tres.", "Cierre sereno."))
        saved = [(m.sender, m.turn_number) for m in chat.messages.all()]
        self.assertEqual(
            saved,
            [("KOMI_AI", 1), ("USER", 1), ("KOMI_AI", 2), ("USER", 2), ("KOMI_AI", 3),
             ("USER", 3), ("KOMI_AI", 4), ("USER", 4), ("KOMI_AI", 5)],
        )  # fmt: skip
        self.assertEqual(chat.messages.last().content, "Cierre sereno.")

    def test_the_last_done_event_closes_the_chat_and_carries_the_seed(self):
        _, results = self.full_conversation(FakeGemini())
        last = results[-1][-1]
        self.assertEqual(last[0], "done")
        self.assertEqual((last[1]["turn"], last[1]["is_closed"]), (5, True))
        self.assertEqual(last[1]["key_takeaway"], SEED)
        for events in results[:-1]:
            self.assertEqual(
                (events[-1][1]["is_closed"], events[-1][1]["key_takeaway"]), (False, None)
            )

    def test_the_sixth_message_is_rejected_without_calling_gemini(self):
        fake = FakeGemini()
        chat, _ = self.full_conversation(fake)
        calls_before = len(fake.calls)
        response = self.converse(chat, fake, "Una palabra mas")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "chat_closed")
        self.assertEqual(len(fake.calls), calls_before)
        chat.refresh_from_db()
        self.assertEqual((chat.turn_count, chat.messages.count()), (5, 9))
        self.assertEqual(chat.key_takeaway, SEED)

    def test_a_chat_with_turn_count_5_rejects_even_if_not_marked_closed(self):
        chat = self.new_chat()
        ReflectionChat.objects.filter(pk=chat.pk).update(turn_count=5, is_closed=False)
        fake = FakeGemini()
        response = self.converse(chat, fake)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(fake.calls, [])

    def test_a_closed_chat_rejects_even_with_a_stale_turn_count(self):
        chat = self.new_chat()
        ReflectionChat.objects.filter(pk=chat.pk).update(is_closed=True)
        fake = FakeGemini()
        self.assertEqual(self.converse(chat, fake).status_code, 409)
        self.assertEqual(fake.calls, [])

    def test_without_a_seed_the_chat_still_closes(self):
        fake = FakeGemini(seed=None)
        chat, results = self.full_conversation(fake)
        self.assertEqual((chat.turn_count, chat.is_closed, chat.key_takeaway), (5, True, None))
        done = results[-1][-1]
        self.assertEqual(
            (done[0], done[1]["is_closed"], done[1]["key_takeaway"]), ("done", True, None)
        )

    def test_a_blank_seed_is_stored_as_null(self):
        chat, _ = self.full_conversation(FakeGemini(seed="   "))
        self.assertTrue(chat.is_closed)
        self.assertIsNone(chat.key_takeaway)

    def test_a_long_seed_is_trimmed(self):
        chat, _ = self.full_conversation(FakeGemini(seed="s" * 800))
        self.assertEqual(len(chat.key_takeaway), services.MAX_KEY_TAKEAWAY_CHARS)

    def test_a_chat_can_be_resumed_from_start_after_losing_the_connection(self):
        chat = self.new_chat()
        self.converse(chat, FakeGemini("Uno."))
        again = self.start().json()
        self.assertEqual(again["chat_id"], str(chat.id))
        self.assertEqual(again["turn_count"], 2)
        self.assertEqual(len(again["messages"]), 3)


class LockTests(CompanionTestCase):
    def test_a_reserved_chat_rejects_a_second_send_without_calling_gemini(self):
        chat = self.new_chat()
        ReflectionChat.objects.filter(pk=chat.pk).update(pending_since=timezone.now())
        fake = FakeGemini()
        response = self.converse(chat, fake)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "reply_in_progress")
        self.assertEqual(fake.calls, [])
        chat.refresh_from_db()
        self.assertIsNotNone(chat.pending_since)  # el candado ajeno no se toca
        self.assertEqual(chat.messages.count(), 1)

    def test_an_expired_lock_is_taken_over(self):
        chat = self.new_chat()
        stale = timezone.now() - timedelta(seconds=100)
        ReflectionChat.objects.filter(pk=chat.pk).update(pending_since=stale)
        events = parse_sse(self.converse(chat, FakeGemini("Retomo.")))
        self.assertEqual(events[-1][0], "done")

    def test_a_lock_just_inside_the_ttl_still_blocks(self):
        chat = self.new_chat()
        recent = timezone.now() - timedelta(seconds=80)
        ReflectionChat.objects.filter(pk=chat.pk).update(pending_since=recent)
        self.assertEqual(self.converse(chat, FakeGemini()).status_code, 409)

    def test_the_lock_is_released_after_success_and_after_failure(self):
        chat = self.new_chat()
        self.converse(chat, FakeGemini(GeminiUnavailableError("x")))
        chat.refresh_from_db()
        self.assertIsNone(chat.pending_since)
        self.converse(chat, FakeGemini("Bien."))
        chat.refresh_from_db()
        self.assertIsNone(chat.pending_since)

    def test_a_stale_claim_cannot_save_over_a_newer_one(self):
        chat = self.new_chat()
        first = services.claim_reply(self.profile, chat.id, "primero")
        later = first.token + timedelta(seconds=100)
        with mock.patch("apps.ai_companion.services.timezone.now", return_value=later):
            second = services.claim_reply(self.profile, chat.id, "segundo")
        finished = mock.Mock(text="Respuesta", key_takeaway=None)
        with self.assertRaises(services.ClaimLost):
            services.finalize_reply(first, finished)
        services.finalize_reply(second, finished)
        contents = list(chat.messages.filter(sender="USER").values_list("content", flat=True))
        self.assertEqual(contents, ["segundo"])

    def test_releasing_a_claim_that_is_no_longer_ours_does_nothing(self):
        chat = self.new_chat()
        claim = services.claim_reply(self.profile, chat.id, "hola")
        services.release_claim(chat.id, claim.token - timedelta(seconds=5))
        chat.refresh_from_db()
        self.assertIsNotNone(chat.pending_since)
        services.release_claim(chat.id, claim.token)
        chat.refresh_from_db()
        self.assertIsNone(chat.pending_since)


class RestoreChatsTests(CompanionTestCase):
    def restore(self, profile=None):
        return self.client.get(RESTORE, **self.headers(profile)).json()

    def finish_chat(self, session, fake=None):
        response = self.start(session=session)
        chat = ReflectionChat.objects.get(pk=response.json()["chat_id"])
        for turn in range(1, 5):
            self.converse(chat, fake or FakeGemini(), f"Mensaje {turn}", turn=turn)
        chat.refresh_from_db()
        return chat

    def test_closed_chats_come_back_with_their_seeds_and_messages(self):
        chat = self.finish_chat(self.session)
        data = self.restore()
        self.assertEqual(len(data["chats"]), 1)
        restored = data["chats"][0]
        self.assertEqual(restored["chat_id"], str(chat.id))
        self.assertEqual(restored["session_id"], str(self.session.id))
        self.assertEqual((restored["is_closed"], restored["turn_count"]), (True, 5))
        self.assertEqual(restored["key_takeaway"], SEED)
        self.assertEqual(len(restored["messages"]), 9)
        self.assertEqual(
            [m["turn_number"] for m in restored["messages"]], [1, 1, 2, 2, 3, 3, 4, 4, 5]
        )
        self.assertEqual(restored["messages"][1]["content"], "Mensaje 1")

    def test_a_closed_chat_without_a_seed_is_restored_with_null(self):
        self.finish_chat(self.session, FakeGemini(seed=None))
        self.assertIsNone(self.restore()["chats"][0]["key_takeaway"])

    def test_open_chats_are_not_restored(self):
        self.new_chat()
        self.assertEqual(self.restore()["chats"], [])

    def test_chats_are_ordered_by_the_session_start(self):
        late = make_session(self.profile, started="2025-03-12T08:00")
        early = make_session(self.profile, started="2025-03-11T08:00")
        self.finish_chat(late)
        self.finish_chat(early)
        ids = [chat["session_id"] for chat in self.restore()["chats"]]
        self.assertEqual(ids, [str(early.id), str(late.id)])

    def test_chats_of_other_profiles_never_appear(self):
        theirs = make_session(self.other)
        self.client.post(
            START,
            {"session_id": str(theirs.id)},
            content_type="application/json",
            **self.headers(self.other),
        )
        chat = ReflectionChat.objects.get(session=theirs)
        ReflectionChat.objects.filter(pk=chat.pk).update(
            is_closed=True, turn_count=5, key_takeaway="semilla ajena"
        )
        self.assertEqual(self.restore()["chats"], [])
        self.assertNotIn("semilla ajena", json.dumps(self.restore()))
        self.assertEqual(len(self.restore(self.other)["chats"]), 1)

    def test_chats_of_invalidated_sessions_are_not_restored(self):
        invalid = make_session(self.profile, status=Status.INVALIDATED_GRACE_EXPIRED)
        chat = ReflectionChat.objects.create(session=invalid, is_closed=True, turn_count=5)
        ReflectionMessage.objects.create(chat=chat, sender="KOMI_AI", content="hola", turn_number=1)
        self.assertEqual(self.restore()["chats"], [])

    def test_a_profile_without_chats_restores_an_empty_list(self):
        self.assertEqual(self.restore(self.other)["chats"], [])
