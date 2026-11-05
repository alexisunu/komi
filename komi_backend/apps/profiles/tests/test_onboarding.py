import uuid

from django.test import TestCase

from apps.profiles.models import ReaderProfile

URL = "/api/v1/profile/onboarding/"
ANSWERS = {"q1": "B", "q2": "C", "q3": "C", "q4": "B", "q5": "C"}


class OnboardingTests(TestCase):
    def post(self, body, **extra):
        return self.client.post(URL, body, content_type="application/json", **extra)

    def body(self, profile_id=None, **answers):
        return {
            "profile_id": str(profile_id or uuid.uuid4()),
            "answers": {**ANSWERS, **answers},
        }

    def test_creates_the_profile_with_the_client_uuid(self):
        profile_id = uuid.uuid4()
        response = self.post(self.body(profile_id))
        self.assertEqual(response.status_code, 201)
        self.assertEqual(
            response.json(),
            {
                "profile_id": str(profile_id),
                "daily_goal_minutes": 15,
                "preferred_moment": "NIGHT",
                "ai_reflection_style": "KEY_SUMMARY",
                "preconfigure_tsukimi": True,
            },
        )
        profile = ReaderProfile.objects.get(pk=profile_id)
        self.assertEqual(profile.daily_goal_minutes, 15)
        self.assertEqual(profile.preferred_moment, "NIGHT")
        self.assertEqual(profile.ai_reflection_style, "KEY_SUMMARY")
        self.assertEqual((profile.current_streak, profile.longest_streak), (0, 0))
        self.assertIsNone(profile.last_valid_session_date)
        self.assertIsNone(profile.user)

    def test_server_runs_the_algorithm_of_section_5_1(self):
        response = self.post(self.body(q1="A", q2="D", q3="A", q4="A", q5="A"))
        self.assertEqual(response.json()["daily_goal_minutes"], 15)
        self.assertFalse(response.json()["preconfigure_tsukimi"])
        self.assertEqual(response.json()["ai_reflection_style"], "MEMORY_QUIZ")

    def test_does_not_require_the_profile_header(self):
        self.assertEqual(self.post(self.body()).status_code, 201)

    def test_a_foreign_or_invalid_header_does_not_block_onboarding(self):
        response = self.post(self.body(), HTTP_X_PROFILE_ID="no-es-un-uuid")
        self.assertEqual(response.status_code, 201)

    def test_replay_is_idempotent_and_does_not_overwrite_the_profile(self):
        profile_id = uuid.uuid4()
        self.post(self.body(profile_id))
        replay = self.post(self.body(profile_id, q1="A", q2="A", q3="A", q4="D", q5="A"))
        self.assertEqual(replay.status_code, 200)
        self.assertEqual(ReaderProfile.objects.filter(pk=profile_id).count(), 1)
        stored = ReaderProfile.objects.get(pk=profile_id)
        self.assertEqual(stored.daily_goal_minutes, 15)
        self.assertEqual(stored.preferred_moment, "NIGHT")
        self.assertEqual(stored.ai_reflection_style, "KEY_SUMMARY")
        data = replay.json()
        self.assertEqual(data["daily_goal_minutes"], 15)
        self.assertEqual(data["preferred_moment"], "NIGHT")
        self.assertIsNone(data["preconfigure_tsukimi"])

    def test_rejects_invalid_answers_without_creating_anything(self):
        invalid = [
            self.body(q1="E"),
            self.body(q2="Z"),
            self.body(q3="a"),
            self.body(q4=""),
            self.body(q5="D"),
            {**self.body(), "answers": {"q1": "A"}},
            {"profile_id": str(uuid.uuid4())},
            {"answers": ANSWERS},
            {**self.body(), "profile_id": "no-es-un-uuid"},
            {},
        ]
        for body in invalid:
            with self.subTest(body=body):
                self.assertEqual(self.post(body).status_code, 400)
        self.assertEqual(ReaderProfile.objects.count(), 0)

    def test_rejects_non_json_bodies(self):
        response = self.client.post(URL, "profile_id=x", content_type="text/plain")
        self.assertEqual(response.status_code, 415)
        self.assertEqual(ReaderProfile.objects.count(), 0)

    def test_only_post_is_allowed(self):
        self.assertEqual(self.client.get(URL).status_code, 405)
        self.assertEqual(self.client.delete(URL).status_code, 405)
