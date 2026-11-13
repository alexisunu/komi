import threading
import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from unittest import mock

from django.db import connection
from django.test import Client, TestCase, TransactionTestCase

from apps.garden.models import BookGarden
from apps.profiles.models import ReaderProfile
from apps.reading_sessions.models import ReadingSession

URL = "/api/v1/sessions/complete/"
PLANNED = 900  # 15 minutos


def make_profile():
    return ReaderProfile.objects.create(
        preferred_moment="NIGHT", ai_reflection_style="DEEP_ANALYSIS"
    )


def make_book(profile, **overrides):
    data = {
        "title": "Kokoro",
        "author": "Natsume Soseki",
        "format_type": "PHYSICAL",
        "sunflower_variant": "CLASSIC",
        "total_pages": 264,
    }
    data.update(overrides)
    return BookGarden.objects.create(profile=profile, **data)


def body(book, **overrides):
    data = {
        "id": str(uuid.uuid4()),
        "book_id": str(book.id),
        "planned_duration_sec": PLANNED,
        "actual_duration_sec": PLANNED,
        "started_at_local": "2025-03-10T21:30:00",
        "session_status": "COMPLETED",
    }
    if book.format_type == "PHYSICAL":
        data["current_page"] = 120
    else:
        data["progress_percentage"] = 30.5
    data.update(overrides)
    return data


class SessionTestCase(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.profile = make_profile()
        cls.other = make_profile()
        cls.book = make_book(cls.profile)
        cls.epub = make_book(cls.profile, title="Walden", format_type="EPUB", total_pages=None)

    def post(self, data, profile=None):
        headers = {"HTTP_X_PROFILE_ID": str((profile or self.profile).id)}
        return self.client.post(URL, data, content_type="application/json", **headers)

    def reload(self):
        self.profile.refresh_from_db()
        self.book.refresh_from_db()
        self.epub.refresh_from_db()


class AuthenticationTests(SessionTestCase):
    def test_requires_the_profile_header(self):
        response = self.client.post(URL, body(self.book), content_type="application/json")
        self.assertEqual(response.status_code, 401)
        self.assertEqual(ReadingSession.objects.count(), 0)

    def test_only_post_is_allowed(self):
        headers = {"HTTP_X_PROFILE_ID": str(self.profile.id)}
        self.assertEqual(self.client.get(URL, **headers).status_code, 405)


class PhysicalProgressTests(SessionTestCase):
    def test_completes_a_physical_session(self):
        data = body(self.book)
        response = self.post(data)
        self.assertEqual(response.status_code, 201)
        result = response.json()
        self.assertEqual(result["session"]["id"], data["id"])
        self.assertEqual(result["session"]["session_status"], "COMPLETED")
        self.assertEqual(result["session"]["progress_delta"], 45.45)
        self.assertEqual(result["session"]["started_at_local"], "2025-03-10T21:30:00")
        self.assertFalse(result["session"]["granted_solar_bonus"])
        self.assertEqual(result["book"]["progress_percentage"], 45.45)
        self.assertEqual(result["book"]["growth_stage"], "STEM_2")
        self.assertEqual(result["book"]["current_page"], 120)
        self.assertFalse(result["just_bloomed"])
        self.assertEqual(
            result["streak"],
            {"current": 1, "longest": 1, "last_valid_session_date": "2025-03-10"},
        )
        self.reload()
        self.assertEqual(self.book.progress_percentage, Decimal("45.45"))
        self.assertEqual(self.book.current_page, 120)
        session = ReadingSession.objects.get(pk=data["id"])
        self.assertEqual(session.book_id, self.book.id)
        self.assertEqual(session.progress_delta, Decimal("45.45"))

    def test_progress_accumulates_over_sessions(self):
        self.post(body(self.book, current_page=66))
        response = self.post(body(self.book, current_page=132))
        self.assertEqual(response.json()["book"]["progress_percentage"], 50.0)
        self.assertEqual(response.json()["session"]["progress_delta"], 25.0)

    def test_progress_never_goes_backwards(self):
        self.post(body(self.book, current_page=200))
        response = self.post(body(self.book, current_page=50))
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["session"]["progress_delta"], 0)
        self.reload()
        self.assertEqual(self.book.current_page, 200)
        self.assertEqual(self.book.progress_percentage, Decimal("75.75"))

    def test_stage_follows_the_thresholds(self):
        book = make_book(self.profile, total_pages=100)
        for page, stage in ((24, "SEED_1"), (25, "STEM_2"), (59, "STEM_2"), (60, "BUD_3")):
            with self.subTest(page=page):
                response = self.post(body(book, current_page=page))
                self.assertEqual(response.json()["book"]["growth_stage"], stage)

    def test_rejects_invalid_pages_without_saving_anything(self):
        for extra in ({"current_page": 265}, {"current_page": -1}, {"current_page": "x"}):
            with self.subTest(extra=extra):
                self.assertEqual(self.post(body(self.book, **extra)).status_code, 400)
        data = body(self.book)
        del data["current_page"]
        self.assertEqual(self.post(data).status_code, 400)
        self.assertEqual(ReadingSession.objects.count(), 0)
        self.reload()
        self.assertEqual(self.book.progress_percentage, 0)
        self.assertEqual(self.profile.current_streak, 0)

    def test_percentage_is_truncated_so_100_requires_the_last_page(self):
        book = make_book(self.profile, total_pages=100_000)
        response = self.post(body(book, current_page=99_999))
        self.assertEqual(response.json()["book"]["progress_percentage"], 99.99)
        self.assertFalse(response.json()["just_bloomed"])
        self.assertEqual(response.json()["book"]["status"], "ACTIVE")


class BloomTests(SessionTestCase):
    def test_reaching_the_last_page_blooms_the_book(self):
        response = self.post(body(self.book, current_page=264))
        result = response.json()
        self.assertTrue(result["just_bloomed"])
        self.assertEqual(result["book"]["progress_percentage"], 100)
        self.assertEqual(result["book"]["growth_stage"], "BLOOM_4")
        self.assertEqual(result["book"]["status"], "BLOOMED")
        self.assertIsNotNone(result["book"]["completed_at"])

    def test_a_short_session_that_finishes_the_book_is_accepted(self):
        # El cliente envia planned = max(actual, 300) cuando la sesion dura menos de 5 minutos.
        data = body(self.book, current_page=264, planned_duration_sec=300, actual_duration_sec=60)
        response = self.post(data)
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["session"]["session_status"], "COMPLETED")
        self.assertTrue(response.json()["just_bloomed"])
        self.assertEqual(response.json()["streak"]["current"], 1)

    def test_a_short_session_that_does_not_finish_the_book_is_rejected(self):
        data = body(self.book, current_page=263, planned_duration_sec=300, actual_duration_sec=60)
        self.assertEqual(self.post(data).status_code, 400)
        self.assertEqual(ReadingSession.objects.count(), 0)

    def test_a_bloomed_book_rejects_new_valid_sessions(self):
        self.post(body(self.book, current_page=264))
        response = self.post(body(self.book, current_page=264))
        self.assertEqual(response.status_code, 409)
        self.assertEqual(ReadingSession.objects.count(), 1)

    def test_epub_reaching_100_blooms(self):
        response = self.post(body(self.epub, progress_percentage=100))
        self.assertTrue(response.json()["just_bloomed"])
        self.assertEqual(response.json()["book"]["status"], "BLOOMED")


class SolarBonusTests(SessionTestCase):
    def setUp(self):
        self.big = make_book(self.profile, total_pages=1000)

    def bonus(self, **overrides):
        response = self.post(body(self.big, **overrides))
        self.assertEqual(response.status_code, 201)
        return response.json()["session"]

    def test_grants_for_physical_delta_below_one_percent(self):
        session = self.bonus(current_page=5)
        self.assertEqual(session["progress_delta"], 0.5)
        self.assertTrue(session["granted_solar_bonus"])

    def test_grants_for_zero_delta(self):
        self.bonus(current_page=50)
        session = self.bonus(current_page=50)
        self.assertEqual(session["progress_delta"], 0)
        self.assertTrue(session["granted_solar_bonus"])

    def test_grants_when_the_reported_page_is_lower(self):
        self.bonus(current_page=50)
        self.assertTrue(self.bonus(current_page=40)["granted_solar_bonus"])

    def test_does_not_grant_at_exactly_one_percent_or_more(self):
        self.assertFalse(self.bonus(current_page=10)["granted_solar_bonus"])
        self.assertFalse(self.bonus(current_page=30)["granted_solar_bonus"])

    def test_does_not_grant_for_epub(self):
        response = self.post(body(self.epub, progress_percentage=0.5))
        self.assertEqual(response.json()["session"]["progress_delta"], 0.5)
        self.assertFalse(response.json()["session"]["granted_solar_bonus"])

    def test_does_not_grant_for_invalidated_sessions(self):
        session = self.bonus(session_status="INVALIDATED_GRACE_EXPIRED", current_page=5)
        self.assertFalse(session["granted_solar_bonus"])


class EpubProgressTests(SessionTestCase):
    def test_accepts_the_client_percentage_cfi_and_excerpt(self):
        response = self.post(
            body(
                self.epub,
                progress_percentage=30.5,
                last_epub_cfi="epubcfi(/6/14!/4/2/1:0)",
                extracted_epub_excerpt="La luz entraba por el shoji.",
            )
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["book"]["progress_percentage"], 30.5)
        self.assertEqual(response.json()["book"]["last_epub_cfi"], "epubcfi(/6/14!/4/2/1:0)")
        session = ReadingSession.objects.get()
        self.assertEqual(session.extracted_epub_excerpt, "La luz entraba por el shoji.")

    def test_a_lower_percentage_is_clamped_and_does_not_replace_the_cfi(self):
        self.post(body(self.epub, progress_percentage=60, last_epub_cfi="cfi-nuevo"))
        response = self.post(body(self.epub, progress_percentage=20, last_epub_cfi="cfi-viejo"))
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["book"]["progress_percentage"], 60)
        self.assertEqual(response.json()["book"]["last_epub_cfi"], "cfi-nuevo")
        self.assertEqual(response.json()["session"]["progress_delta"], 0)

    def test_requires_a_percentage_between_0_and_100(self):
        for value in (-1, 100.01, "x"):
            with self.subTest(value=value):
                self.assertEqual(
                    self.post(body(self.epub, progress_percentage=value)).status_code, 400
                )
        data = body(self.epub)
        del data["progress_percentage"]
        self.assertEqual(self.post(data).status_code, 400)

    def test_excerpt_limit_and_empty_excerpt(self):
        too_long = body(self.epub, extracted_epub_excerpt="a" * 20_001)
        self.assertEqual(self.post(too_long).status_code, 400)
        ok = body(self.epub, extracted_epub_excerpt="a" * 20_000)
        self.assertEqual(self.post(ok).status_code, 201)
        empty = body(self.epub, extracted_epub_excerpt="")
        self.assertEqual(self.post(empty).status_code, 201)
        self.assertIsNone(ReadingSession.objects.get(pk=empty["id"]).extracted_epub_excerpt)

    def test_physical_books_do_not_store_an_excerpt(self):
        data = body(self.book, extracted_epub_excerpt="no deberia guardarse")
        self.post(data)
        self.assertIsNone(ReadingSession.objects.get(pk=data["id"]).extracted_epub_excerpt)

    def test_epub_ignores_current_page(self):
        response = self.post(body(self.epub, current_page=999))
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["book"]["current_page"], 0)


class ValidityTests(SessionTestCase):
    # Regla unica (FA-3.3): vale el tiempo real de 5:00 a 120:00, o la sesion que termina el libro.
    def test_exactly_five_minutes_is_accepted(self):
        response = self.post(body(self.book, planned_duration_sec=3600, actual_duration_sec=300))
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["session"]["session_status"], "COMPLETED")
        self.assertEqual(response.json()["streak"]["current"], 1)

    def test_four_fifty_nine_is_rejected_and_saves_nothing(self):
        response = self.post(body(self.book, planned_duration_sec=3600, actual_duration_sec=299))
        self.assertEqual(response.status_code, 400)
        self.assertIn("actual_duration_sec", response.json())
        self.assertEqual(ReadingSession.objects.count(), 0)
        self.reload()
        self.assertEqual(self.book.progress_percentage, 0)
        self.assertEqual(self.profile.current_streak, 0)

    def test_exactly_one_hundred_twenty_minutes_is_accepted(self):
        data = body(self.book, planned_duration_sec=7200, actual_duration_sec=7200)
        self.assertEqual(self.post(data).status_code, 201)

    def test_more_than_one_hundred_twenty_minutes_is_rejected(self):
        for extra in (
            {"planned_duration_sec": 7201, "actual_duration_sec": 7201},
            {"planned_duration_sec": 7200, "actual_duration_sec": 7201},
        ):
            with self.subTest(extra=extra):
                self.assertEqual(self.post(body(self.book, **extra)).status_code, 400)
        self.assertEqual(ReadingSession.objects.count(), 0)

    def test_a_short_timer_session_of_five_minutes_or_more_is_accepted(self):
        # Un temporizador de 15 min cortado a los 6: ya no hay regla del 50 %.
        response = self.post(body(self.book, actual_duration_sec=360))
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["session"]["session_status"], "COMPLETED")

    def test_the_planned_time_is_not_the_validity_rule(self):
        # Ni el 50 % ni el tiempo completo: COMPLETED siempre que dure 5 min o mas.
        for actual in (300, 600, PLANNED):
            with self.subTest(actual=actual):
                response = self.post(body(self.book, actual_duration_sec=actual))
                self.assertEqual(response.json()["session"]["session_status"], "COMPLETED")

    def test_the_server_ignores_the_status_the_client_claims(self):
        data = body(self.book, actual_duration_sec=600, session_status="EARLY_VALID")
        self.assertEqual(self.post(data).json()["session"]["session_status"], "COMPLETED")

    def test_planned_out_of_range_is_rejected_on_its_field(self):
        for planned in (299, 7201):
            with self.subTest(planned=planned):
                response = self.post(
                    body(self.book, planned_duration_sec=planned, actual_duration_sec=300)
                )
                self.assertEqual(response.status_code, 400)
                self.assertIn("planned_duration_sec", response.json())

    def test_invalidated_sessions_are_stored_without_touching_progress_or_streak(self):
        data = body(self.book, session_status="INVALIDATED_GRACE_EXPIRED", current_page=200)
        response = self.post(data)
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["session"]["session_status"], "INVALIDATED_GRACE_EXPIRED")
        self.assertEqual(response.json()["session"]["progress_delta"], 0)
        self.assertEqual(response.json()["streak"]["current"], 0)
        self.assertIsNone(response.json()["streak"]["last_valid_session_date"])
        self.reload()
        self.assertEqual(self.book.progress_percentage, 0)
        self.assertEqual(self.book.current_page, 0)
        self.assertEqual(ReadingSession.objects.filter(pk=data["id"]).count(), 1)

    def test_invalidated_sessions_do_not_need_progress_fields(self):
        data = body(self.book, session_status="INVALIDATED_GRACE_EXPIRED", actual_duration_sec=10)
        del data["current_page"]
        self.assertEqual(self.post(data).status_code, 201)

    def test_rejects_invalid_durations_and_fields(self):
        invalid = [
            {"planned_duration_sec": 299},
            {"planned_duration_sec": 7201},
            {"actual_duration_sec": PLANNED + 1},
            {"actual_duration_sec": -1},
            {"session_status": "OTRO"},
            {"started_at_local": "hoy"},
            {"started_at_local": "2025-03-10"},
            {"started_at_local": ""},
            {"started_at_local": 12345},
            {"id": "no-es-uuid"},
            {"book_id": "no-es-uuid"},
        ]
        for extra in invalid:
            with self.subTest(extra=extra):
                self.assertEqual(self.post(body(self.book, **extra)).status_code, 400)
        for field in ("id", "book_id", "planned_duration_sec", "actual_duration_sec"):
            with self.subTest(missing=field):
                data = body(self.book)
                del data[field]
                self.assertEqual(self.post(data).status_code, 400)
        self.assertEqual(ReadingSession.objects.count(), 0)


class BookPreconditionTests(SessionTestCase):
    def test_unknown_book_is_404(self):
        self.assertEqual(self.post(body(self.book, book_id=str(uuid.uuid4()))).status_code, 404)

    def test_another_profiles_book_is_404_and_untouched(self):
        foreign = make_book(self.other)
        response = self.post(body(foreign))
        self.assertEqual(response.status_code, 404)
        foreign.refresh_from_db()
        self.assertEqual(foreign.progress_percentage, 0)
        self.assertEqual(ReadingSession.objects.count(), 0)

    def test_fallow_book_rejects_valid_sessions(self):
        self.book.status = "FALLOW"
        self.book.save()
        self.assertEqual(self.post(body(self.book)).status_code, 409)
        self.assertEqual(ReadingSession.objects.count(), 0)

    def test_fallow_book_still_records_invalidated_sessions(self):
        self.book.status = "FALLOW"
        self.book.save()
        response = self.post(body(self.book, session_status="INVALIDATED_GRACE_EXPIRED"))
        self.assertEqual(response.status_code, 201)


class StreakTests(SessionTestCase):
    def streak(self, started, **overrides):
        response = self.post(body(self.book, started_at_local=started, **overrides))
        self.assertEqual(response.status_code, 201)
        return response.json()["streak"]

    def test_consecutive_days_extend_the_streak(self):
        self.assertEqual(self.streak("2025-03-10T08:00:00")["current"], 1)
        self.assertEqual(self.streak("2025-03-11T08:00:00")["current"], 2)
        self.assertEqual(self.streak("2025-03-12T08:00:00")["current"], 3)

    def test_a_second_session_the_same_day_does_not_change_it(self):
        self.streak("2025-03-10T08:00:00")
        self.assertEqual(self.streak("2025-03-10T22:00:00")["current"], 1)

    def test_a_gap_resets_the_streak_but_keeps_the_longest(self):
        for day in ("10", "11", "12"):
            self.streak(f"2025-03-{day}T08:00:00")
        streak = self.streak("2025-03-15T08:00:00")
        self.assertEqual((streak["current"], streak["longest"]), (1, 3))

    def test_a_backdated_session_does_not_change_the_state(self):
        self.streak("2025-03-12T08:00:00")
        streak = self.streak("2025-03-10T08:00:00")
        self.assertEqual(
            streak, {"current": 1, "longest": 1, "last_valid_session_date": "2025-03-12"}
        )

    def test_an_invalidated_session_does_not_count(self):
        streak = self.streak("2025-03-10T08:00:00", session_status="INVALIDATED_GRACE_EXPIRED")
        self.assertEqual(streak["current"], 0)

    def test_the_streak_uses_the_local_wall_clock_date_across_midnight(self):
        # 23:50 en Bogota (-05:00): el instante UTC ya es el dia siguiente, la fecha local no.
        streak = self.streak("2025-03-10T23:50:00-05:00")
        self.assertEqual(streak["last_valid_session_date"], "2025-03-10")
        next_day = self.streak("2025-03-11T00:10:00-05:00")
        self.assertEqual(next_day["current"], 2)
        stored = ReadingSession.objects.order_by("started_at_local").first()
        self.assertEqual(stored.started_at_local, datetime(2025, 3, 10, 23, 50, tzinfo=UTC))

    def test_the_utc_offset_is_discarded_in_every_notation(self):
        for text in ("2025-03-10T23:50:00", "2025-03-10T23:50:00Z", "2025-03-10T23:50:00+14:00"):
            with self.subTest(text=text):
                data = body(self.book, started_at_local=text, actual_duration_sec=PLANNED)
                response = self.post(data)
                self.assertEqual(
                    response.json()["session"]["started_at_local"], "2025-03-10T23:50:00"
                )

    def test_future_start_times_are_rejected(self):
        now = datetime(2025, 6, 1, 12, 0, tzinfo=UTC)
        with mock.patch("apps.reading_sessions.serializers.timezone.now", return_value=now):
            ok = (now + timedelta(hours=14)).replace(tzinfo=None).isoformat()
            self.assertEqual(self.post(body(self.book, started_at_local=ok)).status_code, 201)
            late = (now + timedelta(hours=15)).replace(tzinfo=None).isoformat()
            self.assertEqual(self.post(body(self.book, started_at_local=late)).status_code, 400)
            far = "2099-01-01T00:00:00"
            self.assertEqual(self.post(body(self.book, started_at_local=far)).status_code, 400)
        self.reload()
        self.assertEqual(self.profile.last_valid_session_date.isoformat(), "2025-06-02")


class IdempotencyTests(SessionTestCase):
    def test_replaying_the_same_session_returns_the_same_result_without_changes(self):
        data = body(self.book)
        first = self.post(data)
        replay = self.post(data)
        self.assertEqual((first.status_code, replay.status_code), (201, 200))
        self.assertEqual(first.json()["session"], replay.json()["session"])
        self.assertEqual(first.json()["streak"], replay.json()["streak"])
        self.assertEqual(ReadingSession.objects.count(), 1)
        self.reload()
        self.assertEqual(self.book.progress_percentage, Decimal("45.45"))
        self.assertEqual(self.profile.current_streak, 1)

    def test_a_replay_with_different_content_does_not_modify_the_session(self):
        data = body(self.book)
        self.post(data)
        replay = self.post({**data, "current_page": 264, "actual_duration_sec": 10})
        self.assertEqual(replay.status_code, 200)
        self.assertEqual(replay.json()["session"]["actual_duration_sec"], PLANNED)
        self.reload()
        self.assertEqual(self.book.current_page, 120)

    def test_replaying_the_session_that_bloomed_the_book_is_not_a_conflict(self):
        data = body(self.book, current_page=264)
        self.post(data)
        replay = self.post(data)
        self.assertEqual(replay.status_code, 200)
        self.assertFalse(replay.json()["just_bloomed"])
        self.assertEqual(replay.json()["book"]["status"], "BLOOMED")

    def test_a_session_id_from_another_profile_is_a_conflict_and_leaks_nothing(self):
        foreign_book = make_book(self.other, title="Secreto")
        foreign = body(foreign_book)
        self.post(foreign, profile=self.other)
        response = self.post(body(self.book, id=foreign["id"]))
        self.assertEqual(response.status_code, 409)
        self.assertNotIn("Secreto", response.content.decode())
        self.assertEqual(ReadingSession.objects.count(), 1)
        self.assertEqual(ReadingSession.objects.get().book_id, foreign_book.id)

    def test_replaying_an_invalidated_session_is_idempotent(self):
        data = body(self.book, session_status="INVALIDATED_GRACE_EXPIRED")
        self.post(data)
        self.assertEqual(self.post(data).status_code, 200)
        self.assertEqual(ReadingSession.objects.count(), 1)


class ConcurrencyTests(TransactionTestCase):
    def test_simultaneous_retries_of_the_same_session_create_one_row(self):
        profile = make_profile()
        book = make_book(profile)
        data = body(book)
        results, barrier = [], threading.Barrier(4)

        def worker():
            try:
                barrier.wait(timeout=10)
                response = Client().post(
                    URL,
                    data,
                    content_type="application/json",
                    HTTP_X_PROFILE_ID=str(profile.id),
                )
                results.append(response.status_code)
            finally:
                connection.close()

        threads = [threading.Thread(target=worker) for _ in range(4)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=30)

        self.assertEqual(sorted(results), [200, 200, 200, 201])
        self.assertEqual(ReadingSession.objects.count(), 1)
        profile.refresh_from_db()
        book.refresh_from_db()
        self.assertEqual(profile.current_streak, 1)
        self.assertEqual(book.progress_percentage, Decimal("45.45"))
