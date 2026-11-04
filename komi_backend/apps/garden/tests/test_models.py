from datetime import UTC, datetime
from decimal import Decimal

from django.db import IntegrityError, transaction
from django.test import SimpleTestCase, TestCase

from apps.garden.models import BookGarden, GrowthStage, stage_for_progress
from apps.profiles.models import ReaderProfile


def make_profile() -> ReaderProfile:
    return ReaderProfile.objects.create(
        preferred_moment=ReaderProfile.PreferredMoment.MORNING,
        ai_reflection_style=ReaderProfile.AiReflectionStyle.MEMORY_QUIZ,
    )


def make_book(profile: ReaderProfile, **overrides) -> BookGarden:
    data = {
        "profile": profile,
        "title": "Kokoro",
        "author": "Natsume Soseki",
        "format_type": BookGarden.FormatType.PHYSICAL,
        "sunflower_variant": BookGarden.SunflowerVariant.CLASSIC,
    }
    data.update(overrides)
    return BookGarden.objects.create(**data)


class StageForProgressTests(SimpleTestCase):
    def test_stage_boundaries(self):
        cases = [
            ("0", GrowthStage.SEED_1),
            ("24.99", GrowthStage.SEED_1),
            ("25", GrowthStage.STEM_2),
            ("59.99", GrowthStage.STEM_2),
            ("60", GrowthStage.BUD_3),
            ("99.99", GrowthStage.BUD_3),
            ("100", GrowthStage.BLOOM_4),
        ]
        for value, expected in cases:
            with self.subTest(progress=value):
                self.assertEqual(stage_for_progress(Decimal(value)), expected)


class BookGardenModelTests(TestCase):
    def setUp(self):
        self.profile = make_profile()

    def test_defaults(self):
        book = make_book(self.profile)
        self.assertEqual(book.progress_percentage, Decimal("0.00"))
        self.assertEqual(book.growth_stage, GrowthStage.SEED_1)
        self.assertEqual(book.status, BookGarden.Status.ACTIVE)
        self.assertEqual(book.current_page, 0)
        self.assertIsNone(book.total_pages)
        self.assertIsNone(book.last_epub_cfi)
        self.assertIsNone(book.completed_at)

    def test_growth_stage_is_derived_on_save(self):
        book = make_book(self.profile, progress_percentage=Decimal("60.00"))
        self.assertEqual(book.growth_stage, GrowthStage.BUD_3)
        book.progress_percentage = Decimal("100.00")
        book.save()
        book.refresh_from_db()
        self.assertEqual(book.growth_stage, GrowthStage.BLOOM_4)

    def test_growth_stage_is_kept_in_sync_with_update_fields(self):
        book = make_book(self.profile)
        book.progress_percentage = Decimal("30.00")
        book.save(update_fields=["progress_percentage"])
        book.refresh_from_db()
        self.assertEqual(book.growth_stage, GrowthStage.STEM_2)

    def test_progress_out_of_range_is_rejected_by_database(self):
        for bad in (Decimal("100.01"), Decimal("-0.01")):
            with self.subTest(progress=bad), self.assertRaises(IntegrityError):
                with transaction.atomic():
                    make_book(self.profile, progress_percentage=bad)

    def test_updated_at_changes_on_save(self):
        book = make_book(self.profile)
        # Se fija una fecha antigua: el reloj de Windows tiene resolucion de ~15 ms y dos
        # llamadas seguidas pueden recibir la misma marca de tiempo.
        old = datetime(2020, 1, 1, tzinfo=UTC)
        BookGarden.objects.filter(pk=book.pk).update(updated_at=old)
        book.refresh_from_db()
        book.current_page = 10
        book.save()
        book.refresh_from_db()
        self.assertGreater(book.updated_at, old)

    def test_books_are_deleted_with_their_profile(self):
        make_book(self.profile)
        self.profile.delete()
        self.assertEqual(BookGarden.objects.count(), 0)
