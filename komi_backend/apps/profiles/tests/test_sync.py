import json
import threading
import uuid
from datetime import UTC, timedelta
from decimal import Decimal
from unittest import mock

from django.db import connection
from django.test import Client, TestCase, TransactionTestCase
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.garden.models import BookGarden
from apps.profiles.models import ReaderProfile
from apps.reading_sessions import services as session_services
from apps.reading_sessions.models import ReadingSession

SYNC = "/api/v1/profile/sync/"
RESTORE = "/api/v1/profile/sync/restore/"
PLANNED = 900


def iso(moment):
    return moment.astimezone(UTC).isoformat().replace("+00:00", "Z")


def hours_ago(hours):
    return iso(timezone.now() - timedelta(hours=hours))


def make_profile():
    return ReaderProfile.objects.create(
        preferred_moment="NIGHT", ai_reflection_style="DEEP_ANALYSIS"
    )


def book_item(**overrides):
    data = {
        "id": str(uuid.uuid4()),
        "title": "Kokoro",
        "author": "Natsume Soseki",
        "format_type": "PHYSICAL",
        "sunflower_variant": "CLASSIC",
        "status": "ACTIVE",
        "total_pages": 264,
        "current_page": 0,
        "updated_at": hours_ago(1),
    }
    data.update(overrides)
    return data


def epub_item(**overrides):
    data = book_item(
        title="Walden", author="Thoreau", format_type="EPUB", total_pages=None, current_page=0
    )
    data.update(overrides)
    return data


def session_item(book_id, **overrides):
    data = {
        "id": str(uuid.uuid4()),
        "book_id": str(book_id),
        "planned_duration_sec": PLANNED,
        "actual_duration_sec": PLANNED,
        "started_at_local": "2025-03-10T21:30:00",
        "session_status": "COMPLETED",
        "current_page": 120,
    }
    data.update(overrides)
    return data


def day(n, **overrides):
    return {"started_at_local": f"2025-03-{n:02d}T08:00:00", **overrides}


class SyncTestCase(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.profile = make_profile()
        cls.other = make_profile()

    def sync(self, books=None, sessions=None, as_profile=None, **extra):
        payload = {"books": books or [], "sessions": sessions or [], **extra}
        headers = {"HTTP_X_PROFILE_ID": str((as_profile or self.profile).id)}
        return self.client.post(SYNC, payload, content_type="application/json", **headers)

    def ok(self, *args, **kwargs):
        response = self.sync(*args, **kwargs)
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def reload_profile(self):
        self.profile.refresh_from_db()
        return self.profile

    def book(self, book_id):
        return BookGarden.objects.get(pk=book_id)


def codes(result, kind):
    return [(r["index"], r["code"]) for r in result[kind]["rejected"]]


class ShapeAndLimitsTests(SyncTestCase):
    def test_requires_the_profile_header(self):
        response = self.client.post(SYNC, {}, content_type="application/json")
        self.assertEqual(response.status_code, 401)

    def test_an_empty_batch_is_valid(self):
        result = self.ok()
        self.assertEqual(result["books"], {"accepted": [], "rejected": []})
        self.assertEqual(result["sessions"], {"accepted": [], "rejected": []})
        self.assertEqual(result["server_books"], [])
        self.assertEqual(
            result["streak"], {"current": 0, "longest": 0, "last_valid_session_date": None}
        )

    def test_the_profile_key_is_ignored(self):
        self.ok(profile={"daily_goal_minutes": 99, "current_streak": 50})
        profile = self.reload_profile()
        self.assertEqual(profile.daily_goal_minutes, 15)
        self.assertEqual(profile.current_streak, 0)

    def test_top_level_shape_errors_are_400(self):
        headers = {"HTTP_X_PROFILE_ID": str(self.profile.id)}
        for payload in ({"books": "x"}, {"sessions": {"a": 1}}, []):
            with self.subTest(payload=payload):
                response = self.client.post(
                    SYNC, payload, content_type="application/json", **headers
                )
                self.assertEqual(response.status_code, 400)

    def test_non_json_bodies_are_415(self):
        headers = {"HTTP_X_PROFILE_ID": str(self.profile.id)}
        response = self.client.post(SYNC, "x=1", content_type="text/plain", **headers)
        self.assertEqual(response.status_code, 415)

    def test_more_than_100_books_or_200_sessions_is_400_and_saves_nothing(self):
        too_many_books = [book_item() for _ in range(101)]
        self.assertEqual(self.sync(books=too_many_books).status_code, 400)
        book = book_item()
        sessions = [session_item(book["id"]) for _ in range(201)]
        self.assertEqual(self.sync(books=[book], sessions=sessions).status_code, 400)
        self.assertEqual(BookGarden.objects.count(), 0)
        self.assertEqual(ReadingSession.objects.count(), 0)

    def test_exactly_the_limits_are_accepted(self):
        books = [book_item() for _ in range(100)]
        result = self.ok(books=books)
        self.assertEqual(len(result["books"]["accepted"]), 100)
        sessions = [
            session_item(books[0]["id"], **day(1 + i % 28, current_page=0)) for i in range(200)
        ]
        result = self.ok(sessions=sessions)
        self.assertEqual(len(result["sessions"]["accepted"]), 200)

    def test_a_body_over_2_5_mb_is_413_and_saves_nothing(self):
        book = epub_item()
        excerpt = "a" * 20_000
        sessions = [
            session_item(
                book["id"],
                progress_percentage=10,
                extracted_epub_excerpt=excerpt,
                **day(1 + i % 28),
            )
            for i in range(200)
        ]
        response = self.sync(books=[book], sessions=sessions)
        self.assertEqual(response.status_code, 413)
        self.assertEqual(BookGarden.objects.count(), 0)
        self.assertEqual(ReadingSession.objects.count(), 0)

    def test_a_full_batch_with_one_excerpt_fits_comfortably(self):
        book = epub_item()
        sessions = [
            session_item(book["id"], progress_percentage=10, **day(1 + i % 28)) for i in range(199)
        ]
        sessions.append(
            session_item(
                book["id"],
                progress_percentage=20,
                extracted_epub_excerpt="a" * 20_000,
                **day(28, started_at_local="2025-03-28T23:00:00"),
            )
        )
        payload = json.dumps({"books": [book], "sessions": sessions})
        self.assertLess(len(payload.encode()), 500_000)
        self.assertEqual(self.sync(books=[book], sessions=sessions).status_code, 200)

    def test_repeated_tandas_are_idempotent(self):
        book = book_item(total_pages=1000)
        sessions = [
            session_item(book["id"], current_page=10 * (i + 1), **day(1 + i % 28))
            for i in range(250)
        ][:250]
        sessions = [s for s in sessions if int(s["current_page"]) <= 1000]
        tandas = [sessions[i : i + 100] for i in range(0, len(sessions), 100)]

        def run():
            results = [self.ok(books=[book], sessions=tanda) for tanda in tandas]
            return results

        first = run()
        snapshot = (
            ReadingSession.objects.count(),
            self.book(book["id"]).progress_percentage,
            self.reload_profile().current_streak,
        )
        second = run()
        self.assertEqual(
            snapshot,
            (
                ReadingSession.objects.count(),
                self.book(book["id"]).progress_percentage,
                self.reload_profile().current_streak,
            ),
        )
        for result in second:
            self.assertEqual({a["result"] for a in result["sessions"]["accepted"]}, {"duplicate"})
        self.assertEqual(
            sum(1 for r in first for a in r["sessions"]["accepted"] if a["result"] == "created"),
            ReadingSession.objects.count(),
        )


class BookCreationTests(SyncTestCase):
    def test_creates_physical_and_epub_books_with_the_client_ids(self):
        physical, epub = book_item(current_page=66), epub_item(progress_percentage=30.5)
        result = self.ok(books=[physical, epub])
        self.assertEqual(
            result["books"]["accepted"],
            [
                {"id": physical["id"], "result": "created"},
                {"id": epub["id"], "result": "created"},
            ],
        )
        self.assertEqual(self.book(physical["id"]).progress_percentage, Decimal("25.00"))
        self.assertEqual(self.book(epub["id"]).progress_percentage, Decimal("30.50"))
        self.assertEqual(self.book(epub["id"]).profile_id, self.profile.id)
        self.assertEqual({b["id"] for b in result["server_books"]}, {physical["id"], epub["id"]})

    def test_physical_progress_is_recomputed_from_pages_not_from_the_client_percentage(self):
        item = book_item(current_page=66, progress_percentage=99)
        self.ok(books=[item])
        self.assertEqual(self.book(item["id"]).progress_percentage, Decimal("25.00"))

    def test_epub_ignores_total_pages_and_current_page(self):
        item = epub_item(total_pages=300, current_page=50, progress_percentage=10)
        self.ok(books=[item])
        book = self.book(item["id"])
        self.assertIsNone(book.total_pages)
        self.assertEqual(book.current_page, 0)

    def test_a_new_book_at_100_blooms(self):
        item = book_item(current_page=264)
        self.ok(books=[item])
        book = self.book(item["id"])
        self.assertEqual((book.status, book.growth_stage), ("BLOOMED", "BLOOM_4"))
        self.assertIsNotNone(book.completed_at)

    def test_a_new_book_can_arrive_in_fallow(self):
        item = book_item(status="FALLOW", current_page=10)
        self.ok(books=[item])
        self.assertEqual(self.book(item["id"]).status, "FALLOW")

    def test_invalid_books_are_rejected_with_their_code_and_the_rest_is_kept(self):
        good = book_item(title="Bueno")
        result = self.ok(
            books=[
                book_item(total_pages=None),
                good,
                book_item(current_page=999),
                book_item(status="BLOOMED"),
                book_item(title=""),
                "no es un objeto",
            ]
        )
        self.assertEqual([a["id"] for a in result["books"]["accepted"]], [good["id"]])
        self.assertEqual([code for _, code in codes(result, "books")], ["validation_error"] * 5)
        self.assertEqual([i for i, _ in codes(result, "books")], [0, 2, 3, 4, 5])
        self.assertEqual(BookGarden.objects.count(), 1)

    def test_updated_at_more_than_5_minutes_ahead_is_rejected_for_that_book_only(self):
        future = iso(timezone.now() + timedelta(minutes=10))
        near = iso(timezone.now() + timedelta(minutes=3))
        late, ok = book_item(updated_at=future), book_item(updated_at=near)
        result = self.ok(books=[late, ok])
        self.assertEqual(codes(result, "books"), [(0, "updated_at_in_future")])
        self.assertEqual([a["id"] for a in result["books"]["accepted"]], [ok["id"]])
        self.assertFalse(BookGarden.objects.filter(pk=late["id"]).exists())

    def test_a_book_id_from_another_profile_is_rejected_and_untouched(self):
        foreign = BookGarden.objects.create(
            profile=self.other,
            title="Secreto",
            author="X",
            format_type="PHYSICAL",
            sunflower_variant="CLASSIC",
            total_pages=100,
        )
        result = self.ok(books=[book_item(id=str(foreign.id), title="Hackeado", current_page=100)])
        self.assertEqual(codes(result, "books"), [(0, "id_conflict")])
        self.assertNotIn("Secreto", json.dumps(result))
        foreign.refresh_from_db()
        self.assertEqual((foreign.title, foreign.progress_percentage), ("Secreto", 0))

    def test_a_repeated_id_in_the_same_batch_is_rejected(self):
        item = book_item()
        result = self.ok(books=[item, {**item, "title": "Otro"}])
        self.assertEqual(codes(result, "books"), [(1, "duplicate_in_batch")])
        self.assertEqual(self.book(item["id"]).title, "Kokoro")


class BookMergeTests(SyncTestCase):
    def setUp(self):
        self.item = epub_item(progress_percentage=40, last_epub_cfi="cfi-A", title="Titulo A")
        self.ok(books=[self.item])

    def merged(self, **overrides):
        update = {**self.item, **overrides}
        result = self.ok(books=[update])
        self.assertEqual(result["books"]["accepted"][0]["result"], "merged")
        return self.book(self.item["id"])

    def test_progress_takes_the_max_in_either_direction(self):
        self.assertEqual(self.merged(progress_percentage=25).progress_percentage, Decimal("40"))
        self.assertEqual(self.merged(progress_percentage=70).progress_percentage, Decimal("70"))
        self.assertEqual(self.merged(progress_percentage=10).progress_percentage, Decimal("70"))

    def test_two_devices_with_different_progress_converge_to_the_max(self):
        # Dispositivo B (adelantado) y luego A (atrasado), y al reves en otro libro.
        self.merged(progress_percentage=80, updated_at=iso(timezone.now() + timedelta(minutes=2)))
        book = self.merged(progress_percentage=55, updated_at=hours_ago(3))
        self.assertEqual(book.progress_percentage, Decimal("80"))

    def test_cfi_title_and_status_come_from_the_most_recent_record(self):
        newer = iso(timezone.now() + timedelta(minutes=2))
        book = self.merged(
            progress_percentage=10,
            last_epub_cfi="cfi-B",
            title="Titulo B",
            status="FALLOW",
            updated_at=newer,
        )
        # El CFI es literal del registro mas reciente, aunque quede por detras del 40%.
        self.assertEqual(book.last_epub_cfi, "cfi-B")
        self.assertEqual(book.title, "Titulo B")
        self.assertEqual(book.status, "FALLOW")
        self.assertEqual(book.progress_percentage, Decimal("40"))

    def test_an_older_record_does_not_override_cfi_title_or_status(self):
        book = self.merged(
            progress_percentage=90,
            last_epub_cfi="cfi-viejo",
            title="Titulo viejo",
            status="FALLOW",
            updated_at=hours_ago(5),
        )
        self.assertEqual(book.last_epub_cfi, "cfi-A")
        self.assertEqual(book.title, "Titulo A")
        self.assertEqual(book.status, "ACTIVE")
        self.assertEqual(book.progress_percentage, Decimal("90"))

    def test_restoring_from_fallow_with_a_newer_record(self):
        self.merged(status="FALLOW", updated_at=iso(timezone.now() + timedelta(minutes=1)))
        book = self.merged(status="ACTIVE", updated_at=iso(timezone.now() + timedelta(minutes=2)))
        self.assertEqual(book.status, "ACTIVE")

    def test_a_blank_cfi_never_erases_the_stored_one(self):
        book = self.merged(
            last_epub_cfi=None, updated_at=iso(timezone.now() + timedelta(minutes=2))
        )
        self.assertEqual(book.last_epub_cfi, "cfi-A")

    def test_immutable_fields_are_not_overwritten(self):
        book = self.merged(
            format_type="PHYSICAL",
            total_pages=500,
            sunflower_variant="AUTUMN",
            updated_at=iso(timezone.now() + timedelta(minutes=2)),
        )
        self.assertEqual(book.format_type, "EPUB")
        self.assertIsNone(book.total_pages)
        self.assertEqual(book.sunflower_variant, "CLASSIC")

    def test_a_repeated_identical_batch_does_not_touch_the_book(self):
        before = self.book(self.item["id"]).updated_at
        for _ in range(3):
            self.merged()
        self.assertEqual(self.book(self.item["id"]).updated_at, before)

    def test_reaching_100_through_a_merge_blooms_once(self):
        first = self.merged(progress_percentage=100)
        self.assertEqual(first.status, "BLOOMED")
        stamp = first.completed_at
        self.assertIsNotNone(stamp)
        again = self.merged(progress_percentage=100)
        self.assertEqual(again.completed_at, stamp)

    def test_merge_rejects_pages_beyond_the_stored_total(self):
        physical = book_item(total_pages=100)
        self.ok(books=[physical])
        result = self.ok(books=[{**physical, "current_page": 150, "total_pages": 999}])
        self.assertEqual(codes(result, "books"), [(0, "validation_error")])


class BloomedBookTests(SyncTestCase):
    """Un libro ya florecido no cambia de estado, progreso ni completed_at al sincronizar."""

    def setUp(self):
        self.completed_at = timezone.now() - timedelta(days=3)
        self.book = BookGarden.objects.create(
            profile=self.profile,
            title="Kokoro",
            author="Soseki",
            format_type="PHYSICAL",
            sunflower_variant="CLASSIC",
            total_pages=264,
            current_page=264,
            progress_percentage=Decimal("100"),
            status="BLOOMED",
            completed_at=self.completed_at,
        )
        self.updated_at = self.book.updated_at

    def assert_untouched(self):
        self.book.refresh_from_db()
        self.assertEqual(self.book.status, "BLOOMED")
        self.assertEqual(self.book.progress_percentage, Decimal("100"))
        self.assertEqual(self.book.growth_stage, "BLOOM_4")
        self.assertEqual(self.book.completed_at, self.completed_at)
        self.assertEqual(self.book.updated_at, self.updated_at)

    def test_a_valid_session_is_accepted_without_changing_the_book(self):
        item = session_item(self.book.id, current_page=264)
        result = self.ok(sessions=[item])
        accepted = result["sessions"]["accepted"][0]
        self.assertEqual(accepted["result"], "created")
        self.assertEqual(accepted["progress_delta"], 0)
        self.assertFalse(accepted["just_bloomed"])
        self.assertTrue(ReadingSession.objects.filter(pk=item["id"]).exists())
        self.assert_untouched()

    def test_a_session_that_reports_fewer_pages_does_not_lower_the_progress(self):
        self.ok(sessions=[session_item(self.book.id, current_page=10)])
        self.assertEqual(ReadingSession.objects.get().progress_delta, Decimal("0"))
        self.assert_untouched()

    def test_a_short_valid_session_below_50_percent_is_still_rejected(self):
        item = session_item(self.book.id, current_page=264, actual_duration_sec=100)
        result = self.ok(sessions=[item])
        self.assertEqual(codes(result, "sessions"), [(0, "below_50_percent")])
        self.assert_untouched()

    def test_a_session_still_counts_for_the_streak(self):
        self.ok(sessions=[session_item(self.book.id, **day(10))])
        self.assertEqual(self.reload_profile().current_streak, 1)

    def test_a_lower_and_newer_book_record_does_not_change_it(self):
        record = book_item(
            id=str(self.book.id),
            current_page=5,
            status="ACTIVE",
            title="Kokoro",
            updated_at=iso(timezone.now() + timedelta(minutes=2)),
        )
        self.ok(books=[record])
        self.book.refresh_from_db()
        self.assertEqual(self.book.status, "BLOOMED")
        self.assertEqual(self.book.progress_percentage, Decimal("100"))
        self.assertEqual(self.book.completed_at, self.completed_at)

    def test_a_fallow_request_on_a_bloomed_book_is_ignored(self):
        record = book_item(
            id=str(self.book.id),
            current_page=264,
            status="FALLOW",
            updated_at=iso(timezone.now() + timedelta(minutes=2)),
        )
        self.ok(books=[record])
        self.book.refresh_from_db()
        self.assertEqual(self.book.status, "BLOOMED")
        self.assertEqual(self.book.completed_at, self.completed_at)

    def test_replaying_the_whole_history_changes_nothing(self):
        batch = [session_item(self.book.id, current_page=264, **day(n)) for n in (1, 2, 3)]
        self.ok(sessions=batch)
        self.ok(sessions=batch)
        self.assert_untouched()
        self.assertEqual(ReadingSession.objects.count(), 3)


class FallowBookTests(SyncTestCase):
    def setUp(self):
        self.book = BookGarden.objects.create(
            profile=self.profile,
            title="Pausado",
            author="X",
            format_type="PHYSICAL",
            sunflower_variant="CLASSIC",
            total_pages=100,
            current_page=40,
            progress_percentage=Decimal("40"),
            status="FALLOW",
        )

    def test_a_valid_session_is_accepted_and_the_book_stays_in_fallow(self):
        result = self.ok(sessions=[session_item(self.book.id, current_page=60)])
        self.assertEqual(result["sessions"]["accepted"][0]["progress_delta"], 20)
        self.book.refresh_from_db()
        self.assertEqual((self.book.status, self.book.progress_percentage), ("FALLOW", 60))
        self.assertIsNone(self.book.completed_at)

    def test_reaching_100_blooms_a_fallow_book(self):
        result = self.ok(sessions=[session_item(self.book.id, current_page=100)])
        self.assertTrue(result["sessions"]["accepted"][0]["just_bloomed"])
        self.book.refresh_from_db()
        self.assertEqual(self.book.status, "BLOOMED")
        self.assertIsNotNone(self.book.completed_at)


class SessionSyncTests(SyncTestCase):
    def setUp(self):
        self.book = book_item(total_pages=1000)
        self.ok(books=[self.book])

    def test_a_book_and_its_sessions_in_the_same_batch(self):
        fresh = book_item(total_pages=100)
        result = self.ok(books=[fresh], sessions=[session_item(fresh["id"], current_page=30)])
        self.assertEqual(result["sessions"]["accepted"][0]["result"], "created")
        self.assertEqual(self.book_obj(fresh["id"]).progress_percentage, Decimal("30"))

    def book_obj(self, book_id):
        return BookGarden.objects.get(pk=book_id)

    def test_sessions_are_processed_chronologically_whatever_the_arrival_order(self):
        late = session_item(self.book["id"], current_page=300, **day(12))
        early = session_item(self.book["id"], current_page=100, **day(10))
        middle = session_item(self.book["id"], current_page=200, **day(11))
        result = self.ok(sessions=[late, early, middle])
        deltas = {a["id"]: a["progress_delta"] for a in result["sessions"]["accepted"]}
        self.assertEqual(deltas[early["id"]], 10)
        self.assertEqual(deltas[middle["id"]], 10)
        self.assertEqual(deltas[late["id"]], 10)
        self.assertEqual(self.book_obj(self.book["id"]).progress_percentage, Decimal("30"))
        self.assertEqual(self.reload_profile().current_streak, 3)

    def test_the_same_batch_in_any_order_gives_the_same_state(self):
        items = [
            session_item(self.book["id"], current_page=100 * n, **day(9 + n)) for n in range(1, 5)
        ]
        states = []
        for order in (items, list(reversed(items)), [items[2], items[0], items[3], items[1]]):
            profile = make_profile()
            book = book_item(total_pages=1000)
            self.ok(books=[book], as_profile=profile)
            batch = [{**s, "id": str(uuid.uuid4()), "book_id": book["id"]} for s in order]
            self.ok(sessions=batch, as_profile=profile)
            profile.refresh_from_db()
            states.append(
                (
                    BookGarden.objects.get(pk=book["id"]).progress_percentage,
                    profile.current_streak,
                    profile.longest_streak,
                    profile.last_valid_session_date,
                    sorted(
                        float(s.progress_delta)
                        for s in ReadingSession.objects.filter(book_id=book["id"])
                    ),
                )
            )
        self.assertEqual(states[0], states[1])
        self.assertEqual(states[0], states[2])

    def test_a_replayed_batch_creates_nothing_and_reports_duplicates(self):
        batch = [session_item(self.book["id"], current_page=50 * n, **day(9 + n)) for n in (1, 2)]
        first = self.ok(sessions=batch)
        state = (self.book_obj(self.book["id"]).updated_at, self.reload_profile().current_streak)
        second = self.ok(sessions=batch)
        self.assertEqual({a["result"] for a in first["sessions"]["accepted"]}, {"created"})
        self.assertEqual({a["result"] for a in second["sessions"]["accepted"]}, {"duplicate"})
        self.assertEqual(ReadingSession.objects.count(), 2)
        self.assertEqual(
            state, (self.book_obj(self.book["id"]).updated_at, self.reload_profile().current_streak)
        )
        self.assertEqual(first["streak"], second["streak"])

    def test_an_existing_session_is_never_overwritten(self):
        item = session_item(self.book["id"], current_page=100)
        self.ok(sessions=[item])
        self.ok(sessions=[{**item, "current_page": 900, "actual_duration_sec": 450}])
        stored = ReadingSession.objects.get(pk=item["id"])
        self.assertEqual(stored.actual_duration_sec, PLANNED)
        self.assertEqual(stored.progress_delta, Decimal("10"))

    def test_the_same_validations_as_sessions_complete_apply_per_item(self):
        book = self.book["id"]
        good = session_item(book, current_page=50, **day(1))
        batch = [
            session_item(book, actual_duration_sec=PLANNED // 2 - 1),
            good,
            session_item(book, started_at_local="2099-01-01T00:00:00"),
            session_item(book, planned_duration_sec=60),
            session_item(book, actual_duration_sec=PLANNED + 1),
            session_item(book, started_at_local="hoy"),
            session_item(book, current_page=5000),
            session_item(str(uuid.uuid4())),
            session_item(book, session_status="OTRO"),
            "no es un objeto",
        ]
        result = self.ok(sessions=batch)
        self.assertEqual([a["id"] for a in result["sessions"]["accepted"]], [good["id"]])
        self.assertEqual(
            codes(result, "sessions"),
            [
                (0, "below_50_percent"),
                (2, "future_start"),
                (3, "validation_error"),
                (4, "validation_error"),
                (5, "validation_error"),
                (6, "validation_error"),
                (7, "book_not_found"),
                (8, "validation_error"),
                (9, "validation_error"),
            ],
        )
        self.assertEqual(ReadingSession.objects.count(), 1)

    def test_rejections_carry_the_index_the_id_and_a_reason(self):
        bad = session_item(self.book["id"], actual_duration_sec=10)
        rejected = self.ok(sessions=[bad])["sessions"]["rejected"][0]
        self.assertEqual(rejected["index"], 0)
        self.assertEqual(rejected["id"], bad["id"])
        self.assertEqual(rejected["code"], "below_50_percent")
        self.assertIn("session_status", rejected["detail"])

    def test_the_50_percent_rule_is_shared_with_complete(self):
        half = session_item(self.book["id"], actual_duration_sec=PLANNED // 2)
        result = self.ok(sessions=[half])
        self.assertEqual(result["sessions"]["accepted"][0]["session_status"], "EARLY_VALID")

    def test_a_short_session_that_blooms_the_book_is_valid(self):
        book = book_item(total_pages=100)
        short = session_item(book["id"], current_page=100, actual_duration_sec=10)
        result = self.ok(books=[book], sessions=[short])
        self.assertEqual(result["sessions"]["accepted"][0]["session_status"], "EARLY_VALID")

    def test_a_session_of_a_rejected_book_is_rejected_as_book_rejected(self):
        broken = book_item(total_pages=None)
        result = self.ok(books=[broken], sessions=[session_item(broken["id"])])
        self.assertEqual(codes(result, "books"), [(0, "validation_error")])
        self.assertEqual(codes(result, "sessions"), [(0, "book_rejected")])

    def test_a_session_of_another_profiles_book_is_book_not_found(self):
        foreign = book_item()
        self.ok(books=[foreign], as_profile=self.other)
        result = self.ok(sessions=[session_item(foreign["id"])])
        self.assertEqual(codes(result, "sessions"), [(0, "book_not_found")])
        self.assertEqual(ReadingSession.objects.count(), 0)

    def test_a_session_id_from_another_profile_is_id_conflict(self):
        foreign = book_item()
        self.ok(books=[foreign], as_profile=self.other)
        theirs = session_item(foreign["id"])
        self.ok(sessions=[theirs], as_profile=self.other)
        result = self.ok(sessions=[{**theirs, "book_id": self.book["id"]}])
        self.assertEqual(codes(result, "sessions"), [(0, "id_conflict")])
        self.assertEqual(ReadingSession.objects.count(), 1)

    def test_a_repeated_session_id_in_the_batch_is_rejected(self):
        item = session_item(self.book["id"], current_page=50)
        result = self.ok(sessions=[item, {**item, "current_page": 500}])
        self.assertEqual(codes(result, "sessions"), [(1, "duplicate_in_batch")])
        self.assertEqual(ReadingSession.objects.count(), 1)

    def test_invalidated_sessions_are_stored_without_progress_or_streak(self):
        item = session_item(
            self.book["id"], session_status="INVALIDATED_GRACE_EXPIRED", current_page=900
        )
        result = self.ok(sessions=[item])
        self.assertEqual(result["sessions"]["accepted"][0]["progress_delta"], 0)
        self.assertEqual(self.book_obj(self.book["id"]).progress_percentage, 0)
        self.assertEqual(self.reload_profile().current_streak, 0)

    def test_the_excerpt_is_kept_only_on_the_most_recent_session(self):
        epub = epub_item()
        sessions = [
            session_item(
                epub["id"],
                progress_percentage=10 * n,
                extracted_epub_excerpt=f"fragmento {n}",
                **day(9 + n),
            )
            for n in (3, 1, 2)
        ]
        result = self.ok(books=[epub], sessions=sessions)
        self.assertEqual(len(result["sessions"]["accepted"]), 3)
        stored = {s.progress_delta: s.extracted_epub_excerpt for s in ReadingSession.objects.all()}
        self.assertEqual(sorted(v for v in stored.values() if v is not None), ["fragmento 3"])
        self.assertEqual(ReadingSession.objects.exclude(extracted_epub_excerpt=None).count(), 1)

    def test_an_invalid_item_rolls_back_its_own_writes_but_not_the_batch(self):
        good = session_item(self.book["id"], current_page=100, **day(1))
        bad = session_item(self.book["id"], current_page=500, **day(2))
        real = session_services.persist_session

        def flaky(book, data, outcome):
            result = real(book, data, outcome)
            if str(data["id"]) == bad["id"]:
                raise ValidationError({"session_status": "fallo simulado tras escribir"})
            return result

        with mock.patch.object(session_services, "persist_session", side_effect=flaky):
            result = self.ok(sessions=[good, bad])
        self.assertEqual([a["id"] for a in result["sessions"]["accepted"]], [good["id"]])
        self.assertEqual(codes(result, "sessions"), [(1, "validation_error")])
        self.assertFalse(ReadingSession.objects.filter(pk=bad["id"]).exists())
        self.assertEqual(self.book_obj(self.book["id"]).progress_percentage, Decimal("10"))


class StreakSyncTests(SyncTestCase):
    def setUp(self):
        self.book = book_item(total_pages=1000)
        self.ok(books=[self.book])

    def run_days(self, days, **overrides):
        batch = [session_item(self.book["id"], current_page=0, **day(n)) for n in days]
        return self.ok(sessions=batch, **overrides)

    def test_the_streak_is_recomputed_from_the_dates(self):
        result = self.run_days([10, 11, 12, 15])
        self.assertEqual(
            result["streak"], {"current": 1, "longest": 3, "last_valid_session_date": "2025-03-15"}
        )

    def test_previous_longest_is_never_lowered(self):
        self.profile.longest_streak = 30
        self.profile.save()
        result = self.run_days([10, 11])
        self.assertEqual((result["streak"]["current"], result["streak"]["longest"]), (2, 30))

    def test_dates_from_earlier_batches_and_from_complete_are_included(self):
        headers = {"HTTP_X_PROFILE_ID": str(self.profile.id)}
        complete = session_item(self.book["id"], current_page=10, **day(10))
        response = self.client.post(
            "/api/v1/sessions/complete/", complete, content_type="application/json", **headers
        )
        self.assertEqual(response.status_code, 201)
        result = self.run_days([11, 12])
        self.assertEqual(result["streak"]["current"], 3)

    def test_a_backfilled_gap_joins_two_runs(self):
        self.run_days([10, 11, 13, 14])
        result = self.run_days([12])
        self.assertEqual(
            result["streak"], {"current": 5, "longest": 5, "last_valid_session_date": "2025-03-14"}
        )

    def test_midnight_uses_the_local_wall_clock(self):
        sessions = [
            session_item(
                self.book["id"], current_page=0, started_at_local="2025-03-10T23:50:00-05:00"
            ),
            session_item(
                self.book["id"], current_page=0, started_at_local="2025-03-11T00:10:00-05:00"
            ),
        ]
        result = self.ok(sessions=sessions)
        self.assertEqual(result["streak"]["current"], 2)

    def test_invalid_and_rejected_sessions_do_not_count(self):
        sessions = [
            session_item(self.book["id"], session_status="INVALIDATED_GRACE_EXPIRED", **day(10)),
            session_item(self.book["id"], actual_duration_sec=10, **day(11)),
        ]
        result = self.ok(sessions=sessions)
        self.assertEqual(result["streak"]["current"], 0)
        self.assertIsNone(result["streak"]["last_valid_session_date"])

    def test_the_streak_is_idempotent_across_repeated_batches(self):
        batch = [session_item(self.book["id"], current_page=0, **day(n)) for n in (10, 11, 12)]
        self.ok(sessions=batch)
        again = self.ok(sessions=batch)
        self.assertEqual(
            again["streak"], {"current": 3, "longest": 3, "last_valid_session_date": "2025-03-12"}
        )


class TwoDevicesTests(SyncTestCase):
    def test_two_devices_reading_the_same_book_offline_converge(self):
        book = book_item(total_pages=1000)
        self.ok(books=[book])
        device_a = [
            session_item(book["id"], current_page=100, **day(10)),
            session_item(book["id"], current_page=150, **day(11)),
        ]
        device_b = [
            session_item(
                book["id"], current_page=120, **day(10, started_at_local="2025-03-10T22:00:00")
            ),
            session_item(book["id"], current_page=400, **day(12)),
        ]
        self.ok(sessions=device_a)
        result = self.ok(sessions=device_b)
        self.assertEqual(len(result["sessions"]["accepted"]), 2)
        self.assertEqual(BookGarden.objects.get(pk=book["id"]).progress_percentage, Decimal("40"))
        self.assertEqual(ReadingSession.objects.count(), 4)
        self.assertEqual(self.reload_profile().current_streak, 3)

    def test_the_arrival_order_of_the_devices_does_not_matter(self):
        def run(first, second):
            profile = make_profile()
            book = book_item(total_pages=1000)
            self.ok(books=[book], as_profile=profile)
            for sessions in (first, second):
                batch = [{**s, "id": str(uuid.uuid4()), "book_id": book["id"]} for s in sessions]
                self.ok(sessions=batch, as_profile=profile)
            profile.refresh_from_db()
            return (
                BookGarden.objects.get(pk=book["id"]).progress_percentage,
                profile.current_streak,
                profile.longest_streak,
            )

        a = [
            session_item("x", current_page=100, **day(10)),
            session_item("x", current_page=150, **day(11)),
        ]
        b = [session_item("x", current_page=400, **day(12))]
        self.assertEqual(run(a, b), run(b, a))


class RestoreTests(SyncTestCase):
    def restore(self, profile=None):
        headers = {"HTTP_X_PROFILE_ID": str((profile or self.profile).id)}
        return self.client.get(RESTORE, **headers)

    def test_requires_the_profile_header(self):
        self.assertEqual(self.client.get(RESTORE).status_code, 401)

    def test_a_profile_without_data_restores_empty_lists(self):
        data = self.restore().json()
        self.assertEqual(data["books"], [])
        self.assertEqual(data["sessions"], [])
        self.assertEqual(data["profile"]["profile_id"], str(self.profile.id))
        self.assertEqual(data["streak"]["current"], 0)

    def test_restore_after_the_client_lost_its_local_database(self):
        # El cliente sincroniza, iOS purga IndexedDB y el cliente pide la hidratacion.
        epub = epub_item(progress_percentage=60, last_epub_cfi="epubcfi(/6/14)")
        physical = book_item(total_pages=200, current_page=50)
        paused = book_item(status="FALLOW", current_page=20)
        done = book_item(current_page=264)
        sessions = [
            session_item(
                epub["id"], progress_percentage=60, extracted_epub_excerpt="texto", **day(10)
            ),
            session_item(physical["id"], current_page=50, **day(11)),
        ]
        synced = self.ok(books=[epub, physical, paused, done], sessions=sessions)

        data = self.restore().json()
        by_id = {b["id"]: b for b in data["books"]}
        self.assertEqual(set(by_id), {epub["id"], physical["id"], paused["id"], done["id"]})
        self.assertEqual(by_id[epub["id"]]["last_epub_cfi"], "epubcfi(/6/14)")
        self.assertEqual(by_id[epub["id"]]["progress_percentage"], 60)
        self.assertEqual(by_id[physical["id"]]["progress_percentage"], 25)
        self.assertEqual(by_id[paused["id"]]["status"], "FALLOW")
        self.assertEqual(by_id[done["id"]]["status"], "BLOOMED")
        self.assertEqual(by_id[done["id"]]["growth_stage"], "BLOOM_4")
        self.assertEqual(len(data["sessions"]), 2)
        self.assertEqual(data["streak"], synced["streak"])
        self.assertEqual(data["streak"]["current"], 2)
        restored = {b["id"]: b for b in synced["server_books"]}
        for book_id, book in restored.items():
            self.assertEqual(book, by_id[book_id])

    def test_sessions_are_ordered_and_do_not_include_excerpts(self):
        epub = epub_item()
        self.ok(
            books=[epub],
            sessions=[
                session_item(
                    epub["id"], progress_percentage=20, extracted_epub_excerpt="secreto", **day(12)
                ),
                session_item(epub["id"], progress_percentage=10, **day(10)),
            ],
        )
        sessions = self.restore().json()["sessions"]
        self.assertEqual(
            [s["started_at_local"] for s in sessions],
            ["2025-03-10T08:00:00", "2025-03-12T08:00:00"],
        )
        self.assertNotIn("secreto", json.dumps(sessions))
        self.assertNotIn("extracted_epub_excerpt", sessions[0])

    def test_restore_only_returns_the_profiles_own_data(self):
        mine, theirs = book_item(title="Mio"), book_item(title="Ajeno")
        self.ok(books=[mine], sessions=[session_item(mine["id"])])
        self.ok(books=[theirs], sessions=[session_item(theirs["id"])], as_profile=self.other)
        data = self.restore().json()
        self.assertEqual([b["title"] for b in data["books"]], ["Mio"])
        self.assertEqual(len(data["sessions"]), 1)
        self.assertNotIn("Ajeno", json.dumps(data))

    def test_restore_then_resync_is_a_no_op(self):
        book = book_item(current_page=50)
        session = session_item(book["id"], current_page=50)
        self.ok(books=[book], sessions=[session])
        before = self.restore().json()
        again = self.ok(books=[book], sessions=[session])
        self.assertEqual(self.restore().json(), before)
        self.assertEqual(again["sessions"]["accepted"][0]["result"], "duplicate")

    def test_only_get_is_allowed(self):
        headers = {"HTTP_X_PROFILE_ID": str(self.profile.id)}
        self.assertEqual(
            self.client.post(RESTORE, {}, content_type="application/json", **headers).status_code,
            405,
        )


class ConcurrencyTests(TransactionTestCase):
    def test_simultaneous_identical_batches_converge_to_one_state(self):
        profile = make_profile()
        book = book_item(total_pages=1000)
        sessions = [session_item(book["id"], current_page=100 * n, **day(9 + n)) for n in (1, 2, 3)]
        payload = {"books": [book], "sessions": sessions}
        results, barrier = [], threading.Barrier(4)

        def worker():
            try:
                barrier.wait(timeout=10)
                response = Client().post(
                    SYNC,
                    payload,
                    content_type="application/json",
                    HTTP_X_PROFILE_ID=str(profile.id),
                )
                results.append((response.status_code, response.json()))
            finally:
                connection.close()

        threads = [threading.Thread(target=worker) for _ in range(4)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=30)

        self.assertEqual([status for status, _ in results], [200] * 4)
        self.assertEqual(ReadingSession.objects.count(), 3)
        self.assertEqual(BookGarden.objects.count(), 1)
        created = sum(
            1
            for _, body in results
            for a in body["sessions"]["accepted"]
            if a["result"] == "created"
        )
        self.assertEqual(created, 3)
        profile.refresh_from_db()
        self.assertEqual((profile.current_streak, profile.longest_streak), (3, 3))
        self.assertEqual(BookGarden.objects.get(pk=book["id"]).progress_percentage, Decimal("30"))

    def test_concurrent_complete_and_sync_do_not_duplicate_the_session(self):
        profile = make_profile()
        book = book_item(total_pages=1000)
        Client().post(
            SYNC,
            {"books": [book], "sessions": []},
            content_type="application/json",
            HTTP_X_PROFILE_ID=str(profile.id),
        )
        item = session_item(book["id"], current_page=100, **day(10))
        statuses, barrier = [], threading.Barrier(2)

        def via_complete():
            try:
                barrier.wait(timeout=10)
                response = Client().post(
                    "/api/v1/sessions/complete/",
                    item,
                    content_type="application/json",
                    HTTP_X_PROFILE_ID=str(profile.id),
                )
                statuses.append(response.status_code)
            finally:
                connection.close()

        def via_sync():
            try:
                barrier.wait(timeout=10)
                response = Client().post(
                    SYNC,
                    {"books": [], "sessions": [item]},
                    content_type="application/json",
                    HTTP_X_PROFILE_ID=str(profile.id),
                )
                statuses.append(response.status_code)
            finally:
                connection.close()

        threads = [threading.Thread(target=via_complete), threading.Thread(target=via_sync)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=30)

        self.assertEqual(ReadingSession.objects.count(), 1)
        self.assertEqual(BookGarden.objects.get(pk=book["id"]).progress_percentage, Decimal("10"))
        profile.refresh_from_db()
        self.assertEqual(profile.current_streak, 1)
