from itertools import product

from django.test import SimpleTestCase

from apps.profiles.services import calculate_habit_plan

NEUTRAL = {"q1": "B", "q3": "A", "q4": "A", "q5": "B"}


def plan(**overrides):
    answers = {**NEUTRAL, "q2": "B", **overrides}
    return calculate_habit_plan(**answers)


class BaseTimeTests(SimpleTestCase):
    def test_base_time_without_protections(self):
        expected = {"A": 10, "B": 15, "C": 30, "D": 45}
        for answer, minutes in expected.items():
            with self.subTest(q2=answer):
                self.assertEqual(plan(q2=answer).daily_goal_minutes, minutes)


class AntiAbandonmentTests(SimpleTestCase):
    def test_beginner_caps_at_15(self):
        for q2, expected in {"A": 10, "B": 15, "C": 15, "D": 15}.items():
            with self.subTest(q2=q2):
                self.assertEqual(plan(q1="A", q2=q2).daily_goal_minutes, expected)

    def test_high_goals_obstacle_caps_at_15(self):
        for q2, expected in {"A": 10, "B": 15, "C": 15, "D": 15}.items():
            with self.subTest(q2=q2):
                self.assertEqual(plan(q4="D", q2=q2).daily_goal_minutes, expected)

    def test_other_experience_and_obstacles_do_not_cap(self):
        for q1, q4 in product("BCD", "ABC"):
            with self.subTest(q1=q1, q4=q4):
                self.assertEqual(plan(q1=q1, q4=q4, q2="D", q3="A").daily_goal_minutes, 45)


class NightFatigueTests(SimpleTestCase):
    def test_bedtime_and_tiredness_with_long_base_sets_15_and_tsukimi(self):
        for q2 in ("C", "D"):
            with self.subTest(q2=q2):
                result = plan(q3="C", q4="B", q2=q2)
                self.assertEqual(result.daily_goal_minutes, 15)
                self.assertTrue(result.preconfigure_tsukimi)

    def test_base_of_20_or_less_does_not_trigger_the_rule(self):
        for q2, goal in {"A": 10, "B": 15}.items():
            with self.subTest(q2=q2):
                result = plan(q3="C", q4="B", q2=q2)
                self.assertEqual(result.daily_goal_minutes, goal)
                self.assertFalse(result.preconfigure_tsukimi)

    def test_both_conditions_are_required(self):
        only_bedtime = plan(q3="C", q4="A", q2="C")
        self.assertEqual(only_bedtime.daily_goal_minutes, 30)
        self.assertFalse(only_bedtime.preconfigure_tsukimi)
        only_tired = plan(q3="A", q4="B", q2="C")
        self.assertEqual(only_tired.daily_goal_minutes, 30)
        self.assertFalse(only_tired.preconfigure_tsukimi)

    def test_rules_combine_without_conflict(self):
        result = plan(q1="A", q3="C", q4="B", q2="D")
        self.assertEqual(result.daily_goal_minutes, 15)
        self.assertTrue(result.preconfigure_tsukimi)


class MappingTests(SimpleTestCase):
    def test_preferred_moment(self):
        expected = {"A": "MORNING", "B": "AFTERNOON", "C": "NIGHT", "D": "COMMUTE"}
        for answer, moment in expected.items():
            with self.subTest(q3=answer):
                self.assertEqual(plan(q3=answer).preferred_moment, moment)

    def test_reflection_style(self):
        expected = {"A": "MEMORY_QUIZ", "B": "DEEP_ANALYSIS", "C": "KEY_SUMMARY"}
        for answer, style in expected.items():
            with self.subTest(q5=answer):
                self.assertEqual(plan(q5=answer).ai_reflection_style, style)


class InvariantTests(SimpleTestCase):
    def test_every_combination_respects_the_rules(self):
        base = {"A": 10, "B": 15, "C": 30, "D": 45}
        for q1, q2, q3, q4, q5 in product("ABCD", "ABCD", "ABCD", "ABCD", "ABC"):
            with self.subTest(answers=(q1, q2, q3, q4, q5)):
                result = calculate_habit_plan(q1, q2, q3, q4, q5)
                t_base = base[q2]
                self.assertLessEqual(result.daily_goal_minutes, t_base)
                self.assertIn(result.daily_goal_minutes, (10, 15, 30, 45))
                protected = q1 == "A" or q4 == "D"
                fatigued = q3 == "C" and q4 == "B" and t_base > 20
                if protected or fatigued:
                    self.assertLessEqual(result.daily_goal_minutes, 15)
                else:
                    self.assertEqual(result.daily_goal_minutes, t_base)
                self.assertEqual(result.preconfigure_tsukimi, fatigued)
