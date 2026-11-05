import random
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from django.test import SimpleTestCase

from apps.garden.models import BookGarden
from apps.reading_sessions.models import ReadingSession
from apps.reading_sessions.streak_engine import (
    StreakState,
    apply_session,
    apply_session_if_valid,
    effective_streak,
    grants_solar_bonus,
    is_valid_status,
    recompute_from_dates,
    session_local_date,
)

BOGOTA = ZoneInfo("America/Bogota")
TOKYO = ZoneInfo("Asia/Tokyo")
AUCKLAND = ZoneInfo("Pacific/Auckland")
NEW_YORK = ZoneInfo("America/New_York")
MADRID = ZoneInfo("Europe/Madrid")
LOS_ANGELES = ZoneInfo("America/Los_Angeles")

Status = ReadingSession.SessionStatus
Format = BookGarden.FormatType

EMPTY = StreakState(current=0, longest=0, last_date=None)


def wall(iso: str) -> datetime:
    """Convierte un ISO con desfase en la hora de pared que guarda started_at_local.

    Replica la convencion de Sprint 1: se conserva el reloj local y se descarta el desfase.
    """
    return datetime.fromisoformat(iso).replace(tzinfo=UTC)


def wall_from_instant(instant_utc: datetime, zone: ZoneInfo) -> datetime:
    """Hora de pared que veria el dispositivo en `zone` para un instante real."""
    return instant_utc.astimezone(zone).replace(tzinfo=UTC)


def d(day: int, month: int = 11, year: int = 2026) -> date:
    return date(year, month, day)


def run(dates: list[date], state: StreakState = EMPTY) -> StreakState:
    for day in dates:
        state = apply_session(state, day)
    return state


class IsValidStatusTests(SimpleTestCase):
    def test_only_completed_and_early_valid_count(self):
        self.assertTrue(is_valid_status(Status.COMPLETED))
        self.assertTrue(is_valid_status(Status.EARLY_VALID))
        self.assertFalse(is_valid_status(Status.INVALIDATED_GRACE_EXPIRED))

    def test_accepts_plain_strings(self):
        self.assertTrue(is_valid_status("COMPLETED"))
        self.assertFalse(is_valid_status("INVALIDATED_GRACE_EXPIRED"))
        self.assertFalse(is_valid_status("UNKNOWN"))


class SessionLocalDateTests(SimpleTestCase):
    def test_bogota_late_night_belongs_to_its_own_day(self):
        sent = datetime.fromisoformat("2026-11-03T23:50:00-05:00")
        # Convertir a UTC movería la sesion al 4 de noviembre: el error que se evita.
        self.assertEqual(sent.astimezone(UTC).date(), d(4))
        self.assertEqual(session_local_date(wall("2026-11-03T23:50:00-05:00")), d(3))

    def test_session_crossing_midnight_counts_for_the_start_day(self):
        start = wall("2026-11-03T23:50:00-05:00")
        end = start + timedelta(minutes=20)
        self.assertEqual(end.date(), d(4))
        self.assertEqual(session_local_date(start), d(3))

    def test_last_second_and_first_second_are_different_days(self):
        self.assertEqual(session_local_date(wall("2026-11-03T23:59:59-05:00")), d(3))
        self.assertEqual(session_local_date(wall("2026-11-04T00:00:00-05:00")), d(4))

    def test_late_night_then_just_after_midnight_make_a_two_day_streak(self):
        first = session_local_date(wall("2026-11-03T23:50:00-05:00"))
        second = session_local_date(wall("2026-11-04T00:05:00-05:00"))
        self.assertEqual(run([first, second]).current, 2)

    def test_same_instant_gives_different_local_dates_per_zone(self):
        instant = datetime(2026, 11, 3, 12, 0, tzinfo=UTC)
        expected = {BOGOTA: d(3), TOKYO: d(3), AUCKLAND: d(4)}
        for zone, expected_date in expected.items():
            with self.subTest(zone=zone.key):
                self.assertEqual(
                    session_local_date(wall_from_instant(instant, zone)), expected_date
                )

    def test_wall_clock_is_not_converted_even_if_tzinfo_is_not_utc(self):
        aware = datetime(2026, 11, 3, 23, 50, tzinfo=BOGOTA)
        self.assertEqual(session_local_date(aware), d(3))

    def test_naive_datetime_is_accepted(self):
        self.assertEqual(session_local_date(datetime(2026, 11, 3, 23, 50)), d(3))


class DaylightSavingTests(SimpleTestCase):
    def test_25_hour_day_new_york_instants_24h_apart_share_a_local_date(self):
        # 2026-11-01: fin del horario de verano en EE. UU. (el dia dura 25 horas).
        first = datetime(2026, 11, 1, 4, 30, tzinfo=UTC)  # 00:30 EDT
        second = first + timedelta(hours=24)  # 23:30 EST, el mismo dia local
        dates = [session_local_date(wall_from_instant(i, NEW_YORK)) for i in (first, second)]
        self.assertEqual(dates, [d(1), d(1)])
        self.assertEqual(run(dates).current, 1)

    def test_23_hour_day_new_york_sessions_stay_on_the_same_day(self):
        # 2026-03-08: inicio del horario de verano (el dia dura 23 horas).
        first = datetime(2026, 3, 8, 5, 30, tzinfo=UTC)  # 00:30 EST
        second = datetime(2026, 3, 9, 3, 30, tzinfo=UTC)  # 23:30 EDT
        dates = [session_local_date(wall_from_instant(i, NEW_YORK)) for i in (first, second)]
        self.assertEqual(dates, [d(8, 3), d(8, 3)])

    def test_consecutive_days_across_the_spring_change_form_a_streak(self):
        sessions = [
            datetime(2026, 3, 7, 23, 0, tzinfo=NEW_YORK),
            datetime(2026, 3, 8, 23, 0, tzinfo=NEW_YORK),
            datetime(2026, 3, 9, 23, 0, tzinfo=NEW_YORK),
        ]
        dates = [session_local_date(s.replace(tzinfo=UTC)) for s in sessions]
        self.assertEqual(run(dates).current, 3)

    def test_madrid_changes_do_not_break_or_duplicate_days(self):
        for label, days in (("otono", (24, 25, 26)), ("primavera", (28, 29, 30))):
            month = 10 if label == "otono" else 3
            with self.subTest(change=label):
                dates = [
                    session_local_date(
                        datetime(2026, month, day, 23, 30, tzinfo=MADRID).replace(tzinfo=UTC)
                    )
                    for day in days
                ]
                self.assertEqual(run(dates).current, 3)


class TravelTests(SimpleTestCase):
    def test_eastward_trip_keeps_consecutive_local_days(self):
        # Lee el 3 a las 22:00 en Bogota y el 4 a las 22:00 en Madrid.
        a = session_local_date(datetime(2026, 11, 3, 22, 0, tzinfo=BOGOTA).replace(tzinfo=UTC))
        b = session_local_date(datetime(2026, 11, 4, 22, 0, tzinfo=MADRID).replace(tzinfo=UTC))
        self.assertEqual(run([a, b]).current, 2)

    def test_crossing_the_date_line_eastward_skips_a_day_and_resets(self):
        # Comportamiento documentado de la regla de hora local: si el calendario local
        # salta un dia al viajar hacia el oeste de Asia, la racha se reinicia.
        before = wall_from_instant(datetime(2026, 11, 4, 4, 0, tzinfo=UTC), LOS_ANGELES)  # 3 nov
        after = wall_from_instant(datetime(2026, 11, 4, 22, 0, tzinfo=UTC), TOKYO)  # 5 nov
        dates = [session_local_date(before), session_local_date(after)]
        self.assertEqual(dates, [d(3), d(5)])
        self.assertEqual(run(dates), StreakState(current=1, longest=1, last_date=d(5)))

    def test_crossing_back_westward_repeats_a_date_without_losing_the_streak(self):
        tokyo = wall_from_instant(datetime(2026, 11, 3, 22, 0, tzinfo=UTC), TOKYO)  # 4 nov
        la = wall_from_instant(datetime(2026, 11, 4, 4, 0, tzinfo=UTC), LOS_ANGELES)  # 3 nov
        dates = [session_local_date(tokyo), session_local_date(la)]
        self.assertEqual(dates, [d(4), d(3)])
        state = run([d(3), d(4)])
        self.assertEqual(apply_session(state, d(3)), state)


class ApplySessionTests(SimpleTestCase):
    def test_first_session_starts_a_streak_of_one(self):
        self.assertEqual(apply_session(EMPTY, d(3)), StreakState(1, 1, d(3)))

    def test_second_session_same_day_changes_nothing(self):
        state = run([d(3)])
        self.assertEqual(apply_session(state, d(3)), state)

    def test_consecutive_days_increment(self):
        self.assertEqual(run([d(3), d(4), d(5)]), StreakState(3, 3, d(5)))

    def test_gap_of_two_or_more_days_resets_to_one(self):
        for gap in (2, 3, 30):
            with self.subTest(gap=gap):
                state = run([d(1), d(2), d(3)])
                result = apply_session(state, d(3) + timedelta(days=gap))
                self.assertEqual(result.current, 1)

    def test_longest_is_preserved_after_a_reset(self):
        state = run([d(1), d(2), d(3), d(10)])
        self.assertEqual(state, StreakState(current=1, longest=3, last_date=d(10)))

    def test_longest_grows_when_current_overtakes_it(self):
        state = run([d(1), d(2), d(10), d(11), d(12)])
        self.assertEqual(state, StreakState(current=3, longest=3, last_date=d(12)))

    def test_backdated_session_does_not_change_the_state(self):
        state = run([d(5), d(6), d(7)])
        for earlier in (d(1), d(5), d(6)):
            with self.subTest(earlier=earlier):
                self.assertEqual(apply_session(state, earlier), state)

    def test_month_and_year_boundaries(self):
        self.assertEqual(run([date(2026, 12, 31), date(2027, 1, 1)]).current, 2)
        self.assertEqual(run([date(2028, 2, 28), date(2028, 2, 29), date(2028, 3, 1)]).current, 3)

    def test_state_is_immutable(self):
        state = run([d(3)])
        with self.assertRaises(AttributeError):
            state.current = 99  # type: ignore[misc]


class ApplySessionIfValidTests(SimpleTestCase):
    def test_invalidated_session_does_not_alter_the_streak(self):
        state = run([d(3)])
        result = apply_session_if_valid(
            state, wall("2026-11-04T20:00:00-05:00"), Status.INVALIDATED_GRACE_EXPIRED
        )
        self.assertEqual(result, state)

    def test_valid_statuses_advance_the_streak(self):
        for status in (Status.COMPLETED, Status.EARLY_VALID):
            with self.subTest(status=status):
                result = apply_session_if_valid(
                    run([d(3)]), wall("2026-11-04T20:00:00-05:00"), status
                )
                self.assertEqual(result.current, 2)

    def test_uses_the_local_wall_clock_date(self):
        result = apply_session_if_valid(EMPTY, wall("2026-11-03T23:50:00-05:00"), Status.COMPLETED)
        self.assertEqual(result.last_date, d(3))


class RecomputeFromDatesTests(SimpleTestCase):
    def test_no_dates_returns_empty_state_keeping_previous_longest(self):
        self.assertEqual(recompute_from_dates([]), EMPTY)
        self.assertEqual(recompute_from_dates([], previous_longest=7), StreakState(0, 7, None))

    def test_unordered_and_duplicated_dates_are_normalised(self):
        dates = [d(5), d(3), d(4), d(4), d(3), d(5)]
        self.assertEqual(recompute_from_dates(dates), StreakState(3, 3, d(5)))

    def test_current_is_the_run_ending_at_the_last_date(self):
        dates = [d(1), d(2), d(3), d(4), d(10), d(11)]
        self.assertEqual(recompute_from_dates(dates), StreakState(2, 4, d(11)))

    def test_is_idempotent(self):
        dates = [d(1), d(2), d(5), d(6), d(7)]
        once = recompute_from_dates(dates)
        self.assertEqual(recompute_from_dates(dates + dates), once)
        self.assertEqual(recompute_from_dates(list(reversed(dates))), once)

    def test_previous_longest_is_never_lowered(self):
        dates = [d(1), d(2)]
        self.assertEqual(recompute_from_dates(dates, previous_longest=9).longest, 9)
        self.assertEqual(recompute_from_dates(dates, previous_longest=1).longest, 2)

    def test_matches_applying_sessions_in_chronological_order(self):
        rng = random.Random(20261104)
        for _ in range(200):
            days = sorted({rng.randint(0, 40) for _ in range(rng.randint(0, 30))})
            dates = [d(1) + timedelta(days=n) for n in days]
            with self.subTest(days=days):
                self.assertEqual(recompute_from_dates(dates), run(dates))


class EffectiveStreakTests(SimpleTestCase):
    def setUp(self):
        self.state = run([d(1), d(2), d(3)])

    def test_read_today_or_yesterday_keeps_the_streak(self):
        self.assertEqual(effective_streak(self.state, d(3)), 3)
        self.assertEqual(effective_streak(self.state, d(4)), 3)

    def test_two_or_more_days_without_reading_means_zero(self):
        self.assertEqual(effective_streak(self.state, d(5)), 0)
        self.assertEqual(effective_streak(self.state, d(30)), 0)

    def test_no_sessions_means_zero(self):
        self.assertEqual(effective_streak(EMPTY, d(3)), 0)

    def test_clock_behind_last_date_keeps_the_streak(self):
        self.assertEqual(effective_streak(self.state, d(2)), 3)
        self.assertEqual(effective_streak(self.state, d(1)), 3)


class SolarBonusTests(SimpleTestCase):
    def test_physical_valid_small_progress_qualifies_including_zero(self):
        for delta in ("0", "0.00", "0.5", "0.99"):
            with self.subTest(delta=delta):
                self.assertTrue(
                    grants_solar_bonus(Format.PHYSICAL, Decimal(delta), Status.COMPLETED)
                )

    def test_one_percent_or_more_does_not_qualify(self):
        for delta in ("1", "1.00", "2.5"):
            with self.subTest(delta=delta):
                self.assertFalse(
                    grants_solar_bonus(Format.PHYSICAL, Decimal(delta), Status.COMPLETED)
                )

    def test_negative_delta_does_not_qualify(self):
        self.assertFalse(grants_solar_bonus(Format.PHYSICAL, Decimal("-0.1"), Status.COMPLETED))

    def test_epub_never_qualifies(self):
        self.assertFalse(grants_solar_bonus(Format.EPUB, Decimal("0.5"), Status.COMPLETED))

    def test_invalid_session_never_qualifies(self):
        self.assertFalse(
            grants_solar_bonus(Format.PHYSICAL, Decimal("0.5"), Status.INVALIDATED_GRACE_EXPIRED)
        )

    def test_early_valid_qualifies(self):
        self.assertTrue(grants_solar_bonus(Format.PHYSICAL, Decimal("0.5"), Status.EARLY_VALID))
