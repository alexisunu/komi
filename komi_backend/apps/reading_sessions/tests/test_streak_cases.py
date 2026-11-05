import json
from datetime import date, datetime

from django.test import SimpleTestCase

from apps.reading_sessions import streak_engine
from apps.reading_sessions.streak_cases import FIXTURE_PATH, render


class StreakCasesFixtureTests(SimpleTestCase):
    def test_fixture_is_up_to_date(self):
        self.assertTrue(FIXTURE_PATH.exists(), "Falta el archivo: ejecuta dump_streak_cases.")
        self.assertEqual(
            FIXTURE_PATH.read_bytes().decode("utf-8"),
            render(),
            "streakCases.json esta desactualizado: ejecuta `python manage.py dump_streak_cases`.",
        )

    def test_cases_match_the_engine(self):
        data = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
        self.assertGreater(len(data["cases"]), 128 * 2)
        for case in data["cases"]:
            with self.subTest(case=case["name"]):
                dates = [
                    datetime.fromisoformat(started).date()
                    for started, status in case["sessions"]
                    if streak_engine.is_valid_status(status)
                ]
                state = streak_engine.recompute_from_dates(dates, case["previous_longest"])
                expected = case["expected"]
                self.assertEqual(expected["current"], state.current)
                self.assertEqual(expected["longest"], state.longest)
                self.assertEqual(
                    expected["last_date"], state.last_date.isoformat() if state.last_date else None
                )
                self.assertEqual(
                    expected["effective"],
                    streak_engine.effective_streak(state, date.fromisoformat(case["today"])),
                )
