from datetime import UTC, datetime
from decimal import Decimal

from django.db import IntegrityError, transaction
from django.test import TestCase

from apps.ai_companion.models import ReflectionChat, ReflectionMessage
from apps.garden.models import BookGarden
from apps.profiles.models import ReaderProfile
from apps.reading_sessions.models import ReadingSession


def make_session() -> ReadingSession:
    profile = ReaderProfile.objects.create(
        preferred_moment=ReaderProfile.PreferredMoment.AFTERNOON,
        ai_reflection_style=ReaderProfile.AiReflectionStyle.MEMORY_QUIZ,
    )
    book = BookGarden.objects.create(
        profile=profile,
        title="Kokoro",
        author="Natsume Soseki",
        format_type=BookGarden.FormatType.PHYSICAL,
        sunflower_variant=BookGarden.SunflowerVariant.AUTUMN,
    )
    return ReadingSession.objects.create(
        book=book,
        planned_duration_sec=900,
        actual_duration_sec=900,
        started_at_local=datetime(2026, 11, 3, 20, 0, tzinfo=UTC),
        session_status=ReadingSession.SessionStatus.COMPLETED,
        progress_delta=Decimal("2.00"),
    )


class ReflectionChatModelTests(TestCase):
    def setUp(self):
        self.session = make_session()

    def test_defaults(self):
        chat = ReflectionChat.objects.create(session=self.session)
        self.assertEqual(chat.turn_count, 1)
        self.assertFalse(chat.is_closed)
        self.assertIsNone(chat.key_takeaway)

    def test_turn_count_must_be_between_1_and_5(self):
        for turn_count in (0, 6):
            with self.subTest(turn_count=turn_count), self.assertRaises(IntegrityError):
                with transaction.atomic():
                    ReflectionChat.objects.create(session=self.session, turn_count=turn_count)
        for turn_count in (1, 5):
            with self.subTest(turn_count=turn_count):
                chat = ReflectionChat.objects.create(session=self.session, turn_count=turn_count)
                chat.delete()

    def test_only_one_chat_per_session(self):
        ReflectionChat.objects.create(session=self.session)
        with self.assertRaises(IntegrityError), transaction.atomic():
            ReflectionChat.objects.create(session=self.session)

    def test_chat_is_deleted_with_its_session(self):
        ReflectionChat.objects.create(session=self.session)
        self.session.delete()
        self.assertEqual(ReflectionChat.objects.count(), 0)


class ReflectionMessageModelTests(TestCase):
    def setUp(self):
        self.chat = ReflectionChat.objects.create(session=make_session())

    def test_messages_are_returned_in_insertion_order(self):
        first = ReflectionMessage.objects.create(
            chat=self.chat, sender=ReflectionMessage.Sender.KOMI_AI, content="Hola", turn_number=1
        )
        second = ReflectionMessage.objects.create(
            chat=self.chat, sender=ReflectionMessage.Sender.USER, content="Hola Komi", turn_number=2
        )
        self.assertEqual(list(self.chat.messages.all()), [first, second])
        self.assertIsNotNone(first.created_at)

    def test_turn_number_must_be_between_1_and_5(self):
        for turn_number in (0, 6):
            with self.subTest(turn_number=turn_number), self.assertRaises(IntegrityError):
                with transaction.atomic():
                    ReflectionMessage.objects.create(
                        chat=self.chat,
                        sender=ReflectionMessage.Sender.USER,
                        content="x",
                        turn_number=turn_number,
                    )

    def test_messages_are_deleted_with_their_chat(self):
        ReflectionMessage.objects.create(
            chat=self.chat, sender=ReflectionMessage.Sender.USER, content="x", turn_number=2
        )
        self.chat.delete()
        self.assertEqual(ReflectionMessage.objects.count(), 0)
