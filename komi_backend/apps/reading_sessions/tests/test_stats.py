import uuid
from datetime import UTC, datetime
from decimal import Decimal
from unittest import mock

from django.test import TestCase, override_settings

from apps.ai_companion.models import ReflectionChat
from apps.garden.models import BookGarden
from apps.profiles.models import ReaderProfile
from apps.reading_sessions.models import ReadingSession

URL = "/api/v1/stats/weekly/"
COMPLETE = "/api/v1/sessions/complete/"
Status = ReadingSession.SessionStatus


def make_profile():
    return ReaderProfile.objects.create(
        preferred_moment="NIGHT", ai_reflection_style="DEEP_ANALYSIS"
    )


def make_book(profile, **overrides):
    data = {
        "title": "Kokoro",
        "author": "Soseki",
        "format_type": "PHYSICAL",
        "sunflower_variant": "CLASSIC",
        "total_pages": 1000,
    }
    data.update(overrides)
    return BookGarden.objects.create(profile=profile, **data)


def wall_clock(text):
    """Hora de pared local etiquetada como UTC, igual que la guarda sessions/complete."""
    return datetime.fromisoformat(text).replace(tzinfo=UTC)


def make_session(book, started, seconds=900, status=Status.COMPLETED, planned=None):
    return ReadingSession.objects.create(
        book=book,
        planned_duration_sec=planned or max(seconds, 300),
        actual_duration_sec=seconds,
        started_at_local=wall_clock(started),
        session_status=status,
        progress_delta=Decimal("0"),
    )


class StatsTestCase(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.profile = make_profile()
        cls.other = make_profile()
        cls.book = make_book(cls.profile)
        cls.other_book = make_book(cls.other)

    def stats(self, profile=None, **params):
        headers = {"HTTP_X_PROFILE_ID": str((profile or self.profile).id)}
        return self.client.get(URL, params, **headers)

    def week(self, label, profile=None):
        response = self.stats(profile, week=label)
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()


# 2025-03-10 es lunes (semana 2025-W11); 2025-03-09 es domingo (2025-W10).
W11 = "2025-W11"


class SelectionTests(StatsTestCase):
    def test_requires_the_profile_header(self):
        self.assertEqual(self.client.get(URL).status_code, 401)

    def test_only_get_is_allowed(self):
        headers = {"HTTP_X_PROFILE_ID": str(self.profile.id)}
        self.assertEqual(self.client.post(URL, {}, **headers).status_code, 405)

    def test_week_parameter_selects_the_iso_week_monday_to_sunday(self):
        data = self.week(W11)
        self.assertEqual(data["week"], W11)
        self.assertEqual(data["start_date"], "2025-03-10")
        self.assertEqual(data["end_date"], "2025-03-16")
        self.assertEqual(
            [d["date"] for d in data["days"]],
            [f"2025-03-{n}" for n in range(10, 17)],
        )

    def test_today_selects_the_week_that_contains_it(self):
        for today in ("2025-03-10", "2025-03-13", "2025-03-16"):
            with self.subTest(today=today):
                data = self.stats(today=today).json()
                self.assertEqual(data["week"], W11)
        self.assertEqual(self.stats(today="2025-03-17").json()["week"], "2025-W12")
        self.assertEqual(self.stats(today="2025-03-09").json()["week"], "2025-W10")

    def test_without_parameters_it_uses_the_servers_utc_date(self):
        now = datetime(2025, 3, 13, 15, 0, tzinfo=UTC)
        with mock.patch("apps.reading_sessions.views.timezone.now", return_value=now):
            self.assertEqual(self.stats().json()["week"], W11)

    def test_iso_year_boundaries(self):
        # 2020 tiene 53 semanas: el 1 de enero de 2021 pertenece a 2020-W53.
        self.assertEqual(self.stats(today="2021-01-01").json()["week"], "2020-W53")
        self.assertEqual(self.week("2020-W53")["end_date"], "2021-01-03")
        self.assertEqual(self.week("2021-W01")["start_date"], "2021-01-04")
        self.assertEqual(self.stats(today="2024-12-30").json()["week"], "2025-W01")

    def test_invalid_week_values_are_400_with_the_week_key(self):
        for value in (
            "2026-45",
            "2026-W5",
            "2026-W00",
            "2026-W54",
            "2025-W53",
            "2021-W53",
            "abc",
            "",
            "2026-w45",
            "2026-W45 ",
            "1999-W10",
            "2101-W10",
            "02026-W10",
        ):
            with self.subTest(week=value):
                response = self.stats(week=value)
                self.assertEqual(response.status_code, 400)
                self.assertIn("week", response.json())

    def test_invalid_today_values_are_400_with_the_today_key(self):
        for value in ("2026-13-01", "2026-11-31", "20261104", "hoy", "", "2026-1-4", "1999-12-31"):
            with self.subTest(today=value):
                response = self.stats(today=value)
                self.assertEqual(response.status_code, 400)
                self.assertIn("today", response.json())

    def test_week_and_today_together_are_rejected(self):
        response = self.stats(week=W11, today="2025-03-10")
        self.assertEqual(response.status_code, 400)
        self.assertIn("week", response.json())

    def test_a_valid_week_without_data_is_200_with_zeros(self):
        data = self.week("2030-W10")
        self.assertEqual(data["total_seconds"], 0)
        self.assertEqual(data["total_minutes"], 0)
        self.assertEqual(data["sessions_count"], 0)
        self.assertEqual(len(data["days"]), 7)
        self.assertTrue(all(d["seconds"] == 0 and d["sessions"] == 0 for d in data["days"]))
        self.assertEqual(data["completed_chats_week"], 0)
        self.assertEqual(data["bloomed_books_total"], 0)


class AggregationTests(StatsTestCase):
    def test_minutes_are_summed_per_day_with_the_session_counts(self):
        make_session(self.book, "2025-03-10T08:00:00", seconds=900)
        make_session(self.book, "2025-03-10T21:00:00", seconds=1500)
        make_session(self.book, "2025-03-12T07:30:00", seconds=1800)
        make_session(self.book, "2025-03-16T22:00:00", seconds=330)
        data = self.week(W11)
        by_date = {d["date"]: d for d in data["days"]}
        self.assertEqual(by_date["2025-03-10"]["seconds"], 2400)
        self.assertEqual(by_date["2025-03-10"]["minutes"], 40)
        self.assertEqual(by_date["2025-03-10"]["sessions"], 2)
        self.assertEqual(by_date["2025-03-11"]["seconds"], 0)
        self.assertEqual(by_date["2025-03-12"]["minutes"], 30)
        self.assertEqual(by_date["2025-03-16"]["minutes"], 5.5)
        self.assertEqual(data["total_seconds"], 4530)
        self.assertEqual(data["total_minutes"], 75.5)
        self.assertEqual(data["sessions_count"], 4)

    def test_it_sums_the_actual_duration_not_the_planned_one(self):
        make_session(self.book, "2025-03-10T08:00:00", seconds=450, planned=900)
        self.assertEqual(self.week(W11)["total_seconds"], 450)

    def test_early_valid_sessions_count(self):
        make_session(self.book, "2025-03-10T08:00:00", seconds=450, status=Status.EARLY_VALID)
        self.assertEqual(self.week(W11)["total_seconds"], 450)

    def test_sessions_of_other_weeks_are_not_included(self):
        make_session(self.book, "2025-03-09T20:00:00", seconds=600)
        make_session(self.book, "2025-03-17T08:00:00", seconds=700)
        make_session(self.book, "2024-03-12T08:00:00", seconds=800)
        self.assertEqual(self.week(W11)["total_seconds"], 0)
        self.assertEqual(self.week("2025-W10")["total_seconds"], 600)
        self.assertEqual(self.week("2025-W12")["total_seconds"], 700)

    def test_sessions_of_all_the_profiles_books_are_included(self):
        second = make_book(self.profile, title="Otro")
        make_session(self.book, "2025-03-10T08:00:00", seconds=600)
        make_session(second, "2025-03-10T09:00:00", seconds=900)
        self.assertEqual(self.week(W11)["total_seconds"], 1500)


class InvalidSessionTests(StatsTestCase):
    def test_invalidated_sessions_are_excluded(self):
        make_session(self.book, "2025-03-10T08:00:00", seconds=600)
        make_session(
            self.book,
            "2025-03-10T09:00:00",
            seconds=800,
            status=Status.INVALIDATED_GRACE_EXPIRED,
        )
        data = self.week(W11)
        self.assertEqual(data["total_seconds"], 600)
        self.assertEqual(data["sessions_count"], 1)

    def test_a_week_with_only_invalidated_sessions_is_empty(self):
        make_session(
            self.book,
            "2025-03-11T09:00:00",
            seconds=800,
            status=Status.INVALIDATED_GRACE_EXPIRED,
        )
        data = self.week(W11)
        self.assertEqual((data["total_seconds"], data["sessions_count"]), (0, 0))

    def test_sessions_rejected_by_complete_never_reach_the_stats(self):
        headers = {"HTTP_X_PROFILE_ID": str(self.profile.id)}
        short = {
            "id": str(uuid.uuid4()),
            "book_id": str(self.book.id),
            "planned_duration_sec": 900,
            "actual_duration_sec": 100,
            "started_at_local": "2025-03-10T08:00:00",
            "session_status": "COMPLETED",
            "current_page": 10,
        }
        self.assertEqual(
            self.client.post(
                COMPLETE, short, content_type="application/json", **headers
            ).status_code,
            400,
        )
        self.assertEqual(self.week(W11)["total_seconds"], 0)


class WeekBoundaryTests(StatsTestCase):
    """Los limites de semana usan la hora de pared local, no el instante UTC."""

    def complete(self, started, seconds=900, page=10):
        body = {
            "id": str(uuid.uuid4()),
            "book_id": str(self.book.id),
            "planned_duration_sec": seconds,
            "actual_duration_sec": seconds,
            "started_at_local": started,
            "session_status": "COMPLETED",
            "current_page": page,
        }
        headers = {"HTTP_X_PROFILE_ID": str(self.profile.id)}
        response = self.client.post(COMPLETE, body, content_type="application/json", **headers)
        self.assertEqual(response.status_code, 201, response.content)

    def test_sunday_2350_and_monday_0010_in_bogota_fall_in_different_weeks(self):
        # Domingo 23:50 en Bogota es lunes 04:50 UTC: un calculo en UTC lo movería de semana.
        self.complete("2025-03-09T23:50:00-05:00", seconds=900, page=10)
        self.complete("2025-03-10T00:10:00-05:00", seconds=1200, page=20)
        previous, current = self.week("2025-W10"), self.week(W11)
        self.assertEqual(previous["total_seconds"], 900)
        self.assertEqual(previous["days"][6]["date"], "2025-03-09")
        self.assertEqual(previous["days"][6]["seconds"], 900)
        self.assertEqual(current["total_seconds"], 1200)
        self.assertEqual(current["days"][0]["date"], "2025-03-10")
        self.assertEqual(current["days"][0]["seconds"], 1200)

    def test_a_session_that_crosses_midnight_counts_on_its_start_day_and_week(self):
        self.complete("2025-03-09T23:50:00-05:00", seconds=1800)
        self.assertEqual(self.week("2025-W10")["days"][6]["seconds"], 1800)
        self.assertEqual(self.week(W11)["total_seconds"], 0)

    def test_the_first_and_last_instants_of_a_week(self):
        make_session(self.book, "2025-03-10T00:00:00", seconds=300)
        make_session(self.book, "2025-03-16T23:59:59", seconds=400)
        make_session(self.book, "2025-03-17T00:00:00", seconds=500)
        data = self.week(W11)
        self.assertEqual(data["days"][0]["seconds"], 300)
        self.assertEqual(data["days"][6]["seconds"], 400)
        self.assertEqual(data["total_seconds"], 700)
        self.assertEqual(self.week("2025-W12")["total_seconds"], 500)

    def test_the_result_does_not_depend_on_the_servers_time_zone(self):
        make_session(self.book, "2025-03-09T23:50:00", seconds=900)
        make_session(self.book, "2025-03-10T00:10:00", seconds=1200)
        for zone in ("UTC", "America/Bogota", "Asia/Tokyo", "Pacific/Kiritimati"):
            with self.subTest(zone=zone), override_settings(TIME_ZONE=zone):
                previous, current = self.week("2025-W10"), self.week(W11)
                self.assertEqual(previous["days"][6]["seconds"], 900)
                self.assertEqual(current["days"][0]["seconds"], 1200)
                self.assertEqual(previous["total_seconds"] + current["total_seconds"], 2100)

    def test_iso_year_boundary_sessions(self):
        make_session(self.book, "2021-01-01T10:00:00", seconds=600)
        make_session(self.book, "2021-01-04T10:00:00", seconds=900)
        self.assertEqual(self.week("2020-W53")["total_seconds"], 600)
        self.assertEqual(self.week("2021-W01")["total_seconds"], 900)


class ChatsAndBloomTests(StatsTestCase):
    def chat(self, session, closed=True):
        return ReflectionChat.objects.create(session=session, is_closed=closed, turn_count=5)

    def test_only_closed_chats_count_as_completed(self):
        closed = make_session(self.book, "2025-03-10T08:00:00")
        open_chat = make_session(self.book, "2025-03-11T08:00:00")
        self.chat(closed)
        self.chat(open_chat, closed=False)
        data = self.week(W11)
        self.assertEqual(data["completed_chats_week"], 1)
        self.assertEqual(data["completed_chats_total"], 1)

    def test_weekly_chats_follow_the_session_week_and_the_total_covers_all_weeks(self):
        self.chat(make_session(self.book, "2025-03-10T08:00:00"))
        self.chat(make_session(self.book, "2025-03-18T08:00:00"))
        self.chat(make_session(self.book, "2024-12-02T08:00:00"))
        data = self.week(W11)
        self.assertEqual(data["completed_chats_week"], 1)
        self.assertEqual(data["completed_chats_total"], 3)
        self.assertEqual(self.week("2030-W01")["completed_chats_week"], 0)
        self.assertEqual(self.week("2030-W01")["completed_chats_total"], 3)

    def test_chats_of_sunday_night_and_monday_dawn_split_by_local_week(self):
        self.chat(make_session(self.book, "2025-03-09T23:50:00"))
        self.chat(make_session(self.book, "2025-03-10T00:10:00"))
        self.assertEqual(self.week("2025-W10")["completed_chats_week"], 1)
        self.assertEqual(self.week(W11)["completed_chats_week"], 1)

    def test_chats_on_the_week_edges_belong_to_exactly_one_week(self):
        self.chat(make_session(self.book, "2025-03-10T00:00:00"))
        self.chat(make_session(self.book, "2025-03-16T23:59:59"))
        self.chat(make_session(self.book, "2025-03-17T00:00:00"))
        self.assertEqual(self.week("2025-W10")["completed_chats_week"], 0)
        self.assertEqual(self.week(W11)["completed_chats_week"], 2)
        self.assertEqual(self.week("2025-W12")["completed_chats_week"], 1)

    def test_chats_of_invalidated_sessions_are_excluded(self):
        invalid = make_session(
            self.book, "2025-03-10T08:00:00", status=Status.INVALIDATED_GRACE_EXPIRED
        )
        self.chat(invalid)
        data = self.week(W11)
        self.assertEqual(data["completed_chats_week"], 0)
        self.assertEqual(data["completed_chats_total"], 0)

    def test_bloomed_books_are_counted_in_total(self):
        make_book(self.profile, progress_percentage=Decimal("100"), status="BLOOMED")
        make_book(self.profile, progress_percentage=Decimal("100"), status="BLOOMED")
        make_book(self.profile, progress_percentage=Decimal("99.99"))
        make_book(self.profile, status="FALLOW", progress_percentage=Decimal("40"))
        self.assertEqual(self.week(W11)["bloomed_books_total"], 2)


class IsolationTests(StatsTestCase):
    def test_other_profiles_data_never_appears(self):
        make_session(self.book, "2025-03-10T08:00:00", seconds=600)
        theirs = make_session(self.other_book, "2025-03-10T08:00:00", seconds=3000)
        ReflectionChat.objects.create(session=theirs, is_closed=True, turn_count=5)
        make_book(self.other, progress_percentage=Decimal("100"), status="BLOOMED")
        mine = self.week(W11)
        self.assertEqual(mine["total_seconds"], 600)
        self.assertEqual(mine["sessions_count"], 1)
        self.assertEqual(mine["completed_chats_week"], 0)
        self.assertEqual(mine["completed_chats_total"], 0)
        self.assertEqual(mine["bloomed_books_total"], 0)
        theirs_stats = self.week(W11, profile=self.other)
        self.assertEqual(theirs_stats["total_seconds"], 3000)
        self.assertEqual(theirs_stats["completed_chats_week"], 1)
        self.assertEqual(theirs_stats["bloomed_books_total"], 1)

    def test_a_profile_without_data_does_not_see_anyone_elses(self):
        make_session(self.book, "2025-03-10T08:00:00", seconds=600)
        newcomer = make_profile()
        self.assertEqual(self.week(W11, profile=newcomer)["total_seconds"], 0)
