import inspect
from types import SimpleNamespace

from django.core.exceptions import ImproperlyConfigured
from django.test import SimpleTestCase, override_settings
from google.genai import errors

from apps.ai_companion import gemini_client
from apps.ai_companion.gemini_client import (
    MAX_OUTPUT_TOKENS,
    TEMPERATURE,
    Finished,
    GeminiClient,
    GeminiQuotaError,
    GeminiUnavailableError,
    SeedMarkerFilter,
    TextChunk,
    build_contents,
)
from apps.ai_companion.prompt_builder import SEED_MARKER, SESSION_START_USER_TURN

PRIMARY = "modelo-principal"
FALLBACK = "modelo-respaldo"

KOMI = "KOMI_AI"
USER = "USER"


def quota_error(**kwargs):
    body = {"error": {"code": 429, "message": "cuota", "status": "RESOURCE_EXHAUSTED"}}
    body["error"].update(kwargs.pop("extra", {}))
    return errors.ClientError(429, body, **kwargs)


def server_error():
    return errors.ServerError(
        500, {"error": {"code": 500, "message": "boom", "status": "INTERNAL"}}
    )


class FakeModels:
    """Reproduce generate_content_stream de google-genai segun un guion por modelo."""

    def __init__(self, behaviors):
        self.behaviors = behaviors
        self.calls = []

    async def generate_content_stream(self, *, model, contents, config=None):
        self.calls.append({"model": model, "contents": contents, "config": config})
        behavior = self.behaviors[model]
        if behavior.get("on_call"):
            raise behavior["on_call"]
        return self._iterate(behavior["items"])

    async def _iterate(self, items):
        for item in items:
            if isinstance(item, Exception):
                raise item
            yield SimpleNamespace(text=item)


def make_client(behaviors, fallback=FALLBACK):
    models = FakeModels(behaviors)
    fake = SimpleNamespace(aio=SimpleNamespace(models=models))
    client = GeminiClient(client=fake, primary_model=PRIMARY, fallback_model=fallback)
    return client, models


async def collect(agen):
    return [event async for event in agen]


HISTORY = [(KOMI, "Hola, bienvenido."), (USER, "Me gusto el final.")]


class StreamingTests(SimpleTestCase):
    async def test_streams_chunks_in_order_from_the_primary_model(self):
        client, models = make_client({PRIMARY: {"items": ["Hola ", "mundo"]}})
        events = await collect(client.stream_reply("sistema", HISTORY))
        self.assertEqual(
            events, [TextChunk("Hola "), TextChunk("mundo"), Finished("Hola mundo", None, PRIMARY)]
        )
        self.assertEqual([c["model"] for c in models.calls], [PRIMARY])

    async def test_sends_system_prompt_and_generation_parameters(self):
        client, models = make_client({PRIMARY: {"items": ["ok"]}})
        await collect(client.stream_reply("PROMPT DE SISTEMA", HISTORY))
        config = models.calls[0]["config"]
        self.assertEqual(config.system_instruction, "PROMPT DE SISTEMA")
        self.assertEqual(config.max_output_tokens, MAX_OUTPUT_TOKENS)
        self.assertEqual(config.temperature, TEMPERATURE)
        self.assertEqual((MAX_OUTPUT_TOKENS, TEMPERATURE), (220, 0.65))

    async def test_chunks_without_text_are_skipped(self):
        client, _ = make_client({PRIMARY: {"items": [None, "", "texto", None]}})
        events = await collect(client.stream_reply("s", HISTORY))
        self.assertEqual([e for e in events if isinstance(e, TextChunk)], [TextChunk("texto")])

    async def test_empty_response_is_an_error(self):
        client, _ = make_client({PRIMARY: {"items": [None, ""]}})
        with self.assertRaises(GeminiUnavailableError):
            await collect(client.stream_reply("s", HISTORY))


class ContentsTests(SimpleTestCase):
    def test_history_roles_are_mapped_and_user_turn_is_prepended(self):
        contents = build_contents(HISTORY)
        self.assertEqual([c.role for c in contents], ["user", "model", "user"])
        self.assertEqual(contents[0].parts[0].text, SESSION_START_USER_TURN)
        self.assertEqual(contents[1].parts[0].text, "Hola, bienvenido.")
        self.assertEqual(contents[2].parts[0].text, "Me gusto el final.")

    def test_history_already_starting_with_the_user_is_not_modified(self):
        contents = build_contents([(USER, "hola")])
        self.assertEqual([c.role for c in contents], ["user"])

    def test_empty_history_gets_the_synthetic_user_turn(self):
        self.assertEqual([c.role for c in build_contents([])], ["user"])


class FallbackTests(SimpleTestCase):
    async def test_quota_error_when_opening_the_stream_switches_to_fallback(self):
        client, models = make_client(
            {PRIMARY: {"on_call": quota_error()}, FALLBACK: {"items": ["de ", "respaldo"]}}
        )
        events = await collect(client.stream_reply("s", HISTORY))
        self.assertEqual(events[-1], Finished("de respaldo", None, FALLBACK))
        self.assertEqual([c["model"] for c in models.calls], [PRIMARY, FALLBACK])

    async def test_quota_error_on_first_chunk_switches_to_fallback(self):
        client, models = make_client(
            {PRIMARY: {"items": [quota_error()]}, FALLBACK: {"items": ["ok"]}}
        )
        events = await collect(client.stream_reply("s", HISTORY))
        self.assertEqual(events, [TextChunk("ok"), Finished("ok", None, FALLBACK)])
        self.assertEqual(len(models.calls), 2)

    async def test_quota_error_after_text_was_emitted_does_not_switch_model(self):
        client, models = make_client(
            {PRIMARY: {"items": ["parcial", quota_error()]}, FALLBACK: {"items": ["otro"]}}
        )
        received = []
        with self.assertRaises(GeminiQuotaError):
            async for event in client.stream_reply("s", HISTORY):
                received.append(event)
        self.assertEqual(received, [TextChunk("parcial")])
        self.assertEqual([c["model"] for c in models.calls], [PRIMARY])

    async def test_both_models_exhausted_raises_quota_error_with_retry_after(self):
        client, models = make_client(
            {
                PRIMARY: {"on_call": quota_error()},
                FALLBACK: {
                    "on_call": quota_error(response=SimpleNamespace(headers={"retry-after": "12"}))
                },
            }
        )
        with self.assertRaises(GeminiQuotaError) as ctx:
            await collect(client.stream_reply("s", HISTORY))
        self.assertEqual(ctx.exception.retry_after, 12.0)
        self.assertEqual(len(models.calls), 2)

    async def test_retry_after_is_read_from_retry_info_details(self):
        extra = {"details": [{"@type": "RetryInfo", "retryDelay": "30s"}]}
        client, _ = make_client({PRIMARY: {"on_call": quota_error(extra=extra)}}, fallback="")
        with self.assertRaises(GeminiQuotaError) as ctx:
            await collect(client.stream_reply("s", HISTORY))
        self.assertEqual(ctx.exception.retry_after, 30.0)

    async def test_retry_after_is_none_when_unknown(self):
        client, _ = make_client({PRIMARY: {"on_call": quota_error()}}, fallback="")
        with self.assertRaises(GeminiQuotaError) as ctx:
            await collect(client.stream_reply("s", HISTORY))
        self.assertIsNone(ctx.exception.retry_after)

    async def test_no_fallback_configured_raises_quota_error_after_one_call(self):
        client, models = make_client({PRIMARY: {"on_call": quota_error()}}, fallback="")
        with self.assertRaises(GeminiQuotaError):
            await collect(client.stream_reply("s", HISTORY))
        self.assertEqual(len(models.calls), 1)

    async def test_fallback_equal_to_primary_is_not_retried(self):
        client, models = make_client({PRIMARY: {"on_call": quota_error()}}, fallback=PRIMARY)
        with self.assertRaises(GeminiQuotaError):
            await collect(client.stream_reply("s", HISTORY))
        self.assertEqual(len(models.calls), 1)

    async def test_other_api_errors_do_not_switch_model(self):
        for error in (server_error(), errors.ClientError(400, {"error": {"message": "mala"}})):
            with self.subTest(code=error.code):
                client, models = make_client(
                    {PRIMARY: {"on_call": error}, FALLBACK: {"items": ["no"]}}
                )
                with self.assertRaises(GeminiUnavailableError):
                    await collect(client.stream_reply("s", HISTORY))
                self.assertEqual(len(models.calls), 1)

    async def test_network_failures_are_wrapped(self):
        client, _ = make_client({PRIMARY: {"on_call": ConnectionError("sin red")}})
        with self.assertRaises(GeminiUnavailableError):
            await collect(client.stream_reply("s", HISTORY))


class SeedExtractionTests(SimpleTestCase):
    async def test_seed_is_separated_when_requested(self):
        text = f"Gracias por este momento.\n\n{SEED_MARKER} La calma tambien lee."
        client, _ = make_client({PRIMARY: {"items": [text]}})
        events = await collect(client.stream_reply("s", HISTORY, extract_seed=True))
        self.assertEqual(
            events[-1],
            Finished("Gracias por este momento.", "La calma tambien lee.", PRIMARY),
        )
        visible = "".join(e.text for e in events if isinstance(e, TextChunk))
        self.assertNotIn("SEMILLA", visible)

    async def test_marker_split_across_stream_chunks(self):
        items = ["Gracias. [SEM", "ILLA_DEL", "_DIA]:", " Respira", " y lee."]
        client, _ = make_client({PRIMARY: {"items": items}})
        events = await collect(client.stream_reply("s", HISTORY, extract_seed=True))
        self.assertEqual(events[-1], Finished("Gracias.", "Respira y lee.", PRIMARY))

    async def test_marker_is_left_untouched_when_extraction_is_off(self):
        text = f"Hola {SEED_MARKER} frase"
        client, _ = make_client({PRIMARY: {"items": [text]}})
        events = await collect(client.stream_reply("s", HISTORY))
        self.assertEqual(events[-1].text, text)
        self.assertIsNone(events[-1].key_takeaway)

    async def test_missing_marker_leaves_takeaway_empty(self):
        client, _ = make_client({PRIMARY: {"items": ["Cierre sin marcador."]}})
        events = await collect(client.stream_reply("s", HISTORY, extract_seed=True))
        self.assertEqual(events[-1], Finished("Cierre sin marcador.", None, PRIMARY))


class SeedMarkerFilterTests(SimpleTestCase):
    def run_filter(self, chunks):
        seed_filter = SeedMarkerFilter()
        visible = "".join(seed_filter.feed(c) for c in chunks)
        tail, seed = seed_filter.finish()
        return visible + tail, seed

    def test_text_without_marker_passes_through_intact(self):
        text = "Una frase con espacios  y\nsaltos de linea."
        self.assertEqual(self.run_filter([text]), (text, None))

    def test_whitespace_between_words_is_not_lost_across_chunks(self):
        self.assertEqual(self.run_filter(["uno ", "dos ", " tres"]), ("uno dos  tres", None))

    def test_marker_in_a_single_chunk(self):
        self.assertEqual(
            self.run_filter([f"Texto. {SEED_MARKER} Semilla."]), ("Texto.", "Semilla.")
        )

    def test_marker_split_at_every_possible_position(self):
        full = f"Cierre calido.\n\n{SEED_MARKER} Una frase."
        for cut in range(1, len(full)):
            with self.subTest(cut=cut):
                self.assertEqual(
                    self.run_filter([full[:cut], full[cut:]]), ("Cierre calido.", "Una frase.")
                )

    def test_marker_fed_one_character_at_a_time(self):
        full = f"Cierre.{SEED_MARKER}Frase."
        self.assertEqual(self.run_filter(list(full)), ("Cierre.", "Frase."))

    def test_partial_marker_at_the_end_is_released_if_it_never_completes(self):
        self.assertEqual(self.run_filter(["Fin [SEMILLA"]), ("Fin [SEMILLA", None))

    def test_bracket_text_that_is_not_the_marker_is_kept(self):
        self.assertEqual(
            self.run_filter(["ver [nota] y ", "[SEMANA]"]), ("ver [nota] y [SEMANA]", None)
        )

    def test_marker_with_empty_seed_gives_none(self):
        self.assertEqual(self.run_filter([f"Cierre. {SEED_MARKER}   "]), ("Cierre.", None))

    def test_text_is_emitted_incrementally_not_held_until_the_end(self):
        seed_filter = SeedMarkerFilter()
        self.assertEqual(seed_filter.feed("Primera parte."), "Primera parte.")
        self.assertEqual(seed_filter.feed(" Segunda"), " Segunda")

    def test_nothing_is_emitted_after_the_marker(self):
        seed_filter = SeedMarkerFilter()
        seed_filter.feed(f"Fin {SEED_MARKER}")
        self.assertEqual(seed_filter.feed(" mas texto"), "")
        self.assertTrue(seed_filter.found)


class ConfigurationTests(SimpleTestCase):
    @override_settings(GEMINI_API_KEY="clave", GEMINI_PRIMARY_MODEL="p", GEMINI_FALLBACK_MODEL="f")
    def test_models_and_key_come_from_settings(self):
        client = GeminiClient()
        self.assertEqual((client.primary_model, client.fallback_model), ("p", "f"))

    @override_settings(GEMINI_API_KEY="", GEMINI_PRIMARY_MODEL="p", GEMINI_FALLBACK_MODEL="")
    def test_missing_api_key_is_a_configuration_error(self):
        with self.assertRaises(ImproperlyConfigured):
            GeminiClient()

    @override_settings(GEMINI_API_KEY="clave", GEMINI_PRIMARY_MODEL="", GEMINI_FALLBACK_MODEL="")
    def test_missing_primary_model_is_a_configuration_error(self):
        with self.assertRaises(ImproperlyConfigured):
            GeminiClient()

    def test_no_model_names_are_hardcoded_in_the_client(self):
        self.assertNotIn("gemini-", inspect.getsource(gemini_client))
