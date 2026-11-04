from datetime import UTC, datetime
from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.test import TestCase

from apps.garden.models import BookGarden
from apps.profiles.models import ReaderProfile
from apps.reading_sessions.models import ReadingSession


def make_book() -> BookGarden:
    profile = ReaderProfile.objects.create(
        preferred_moment=ReaderProfile.PreferredMoment.NIGHT,
        ai_reflection_style=ReaderProfile.AiReflectionStyle.DEEP_ANALYSIS,
    )
    return BookGarden.objects.create(
        profile=profile,
        title="Kokoro",
        author="Natsume Soseki",
        format_type=BookGarden.FormatType.EPUB,
        sunflower_variant=BookGarden.SunflowerVariant.SOLAR,
    )


def make_session(book: BookGarden, **overrides) -> ReadingSession:
    data = {
        "book": book,
        "planned_duration_sec": 900,
        "actual_duration_sec": 900,
        "started_at_local": datetime(2026, 11, 3, 20, 0, tzinfo=UTC),
        "session_status": ReadingSession.SessionStatus.COMPLETED,
        "progress_delta": Decimal("1.50"),
    }
    data.update(overrides)
    return ReadingSession.objects.create(**data)


class ReadingSessionModelTests(TestCase):
    def setUp(self):
        self.book = make_book()

    def test_defaults(self):
        session = make_session(self.book)
        self.assertFalse(session.granted_solar_bonus)
        self.assertIsNone(session.extracted_epub_excerpt)

    def test_local_wall_clock_survives_round_trip(self):
        """started_at_local guarda la hora de pared local, no un instante real."""
        # El cliente en Bogota (UTC-5) envia 23:50 del 3 de noviembre con su desfase.
        sent = datetime.fromisoformat("2026-11-03T23:50:00-05:00")
        wall_clock = sent.replace(tzinfo=UTC)  # se descarta el desfase (decision de Sprint 1)
        session = make_session(self.book, started_at_local=wall_clock)
        session.refresh_from_db()
        self.assertEqual(session.started_at_local.date().isoformat(), "2026-11-03")
        self.assertEqual((session.started_at_local.hour, session.started_at_local.minute), (23, 50))

    def test_invalid_status_is_rejected_by_validation(self):
        session = ReadingSession(
            book=self.book,
            planned_duration_sec=900,
            actual_duration_sec=900,
            started_at_local=datetime(2026, 11, 3, 20, 0, tzinfo=UTC),
            session_status="UNKNOWN",
            progress_delta=Decimal("0"),
        )
        with self.assertRaises(ValidationError) as ctx:
            session.full_clean()
        self.assertIn("session_status", ctx.exception.message_dict)

    def test_negative_durations_are_rejected_by_database(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            make_session(self.book, actual_duration_sec=-1)

    def test_sessions_are_deleted_with_their_book(self):
        make_session(self.book)
        self.book.delete()
        self.assertEqual(ReadingSession.objects.count(), 0)
