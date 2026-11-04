import uuid

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.test import TestCase

from apps.profiles.models import ReaderProfile


def make_profile(**overrides) -> ReaderProfile:
    data = {
        "preferred_moment": ReaderProfile.PreferredMoment.NIGHT,
        "ai_reflection_style": ReaderProfile.AiReflectionStyle.KEY_SUMMARY,
    }
    data.update(overrides)
    return ReaderProfile.objects.create(**data)


class ReaderProfileModelTests(TestCase):
    def test_defaults_match_srs(self):
        profile = make_profile()
        self.assertEqual(profile.daily_goal_minutes, 15)
        self.assertEqual(profile.current_streak, 0)
        self.assertEqual(profile.longest_streak, 0)
        self.assertIsNone(profile.last_valid_session_date)
        self.assertIsNone(profile.user)

    def test_primary_key_is_client_supplied_uuid(self):
        client_id = uuid.uuid4()
        profile = make_profile(id=client_id)
        self.assertEqual(ReaderProfile.objects.get(pk=client_id).pk, profile.pk)

    def test_invalid_enum_values_are_rejected_by_validation(self):
        profile = ReaderProfile(preferred_moment="NOON", ai_reflection_style="KEY_SUMMARY")
        with self.assertRaises(ValidationError) as ctx:
            profile.full_clean()
        self.assertIn("preferred_moment", ctx.exception.message_dict)

    def test_user_link_is_optional_and_set_null_on_user_delete(self):
        user = get_user_model().objects.create_user(username="lectora")
        profile = make_profile(user=user)
        self.assertEqual(user.reader_profile, profile)
        user.delete()
        profile.refresh_from_db()
        self.assertIsNone(profile.user)
