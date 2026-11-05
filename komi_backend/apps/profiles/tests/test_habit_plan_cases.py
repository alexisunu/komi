import json

from django.test import SimpleTestCase

from apps.profiles.habit_plan_cases import FIXTURE_PATH, render
from apps.profiles.services import calculate_habit_plan


class HabitPlanCasesFixtureTests(SimpleTestCase):
    def test_fixture_is_up_to_date(self):
        self.assertTrue(FIXTURE_PATH.exists(), "Falta el archivo: ejecuta dump_habit_plan_cases.")
        self.assertEqual(
            FIXTURE_PATH.read_bytes().decode("utf-8"),
            render(),
            "habitPlanCases.json esta desactualizado: ejecuta "
            "`python manage.py dump_habit_plan_cases`.",
        )

    def test_fixture_covers_every_combination_and_matches_the_service(self):
        data = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
        self.assertEqual(len(data["cases"]), 4 * 4 * 4 * 4 * 3)
        for case in data["cases"]:
            with self.subTest(answers=case["answers"]):
                plan = calculate_habit_plan(**case["answers"])
                expected = case["expected"]
                self.assertEqual(expected["daily_goal_minutes"], plan.daily_goal_minutes)
                self.assertEqual(expected["preconfigure_tsukimi"], plan.preconfigure_tsukimi)
