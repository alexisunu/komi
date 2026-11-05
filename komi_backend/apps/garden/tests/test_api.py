import uuid
from datetime import timedelta
from decimal import Decimal

from django.test import TestCase
from django.utils import timezone

from apps.garden.models import BookGarden
from apps.profiles.models import ReaderProfile

LIST_URL = "/api/v1/garden/books/"


def detail_url(book_id):
    return f"{LIST_URL}{book_id}/"


def make_profile():
    return ReaderProfile.objects.create(
        preferred_moment="NIGHT", ai_reflection_style="DEEP_ANALYSIS"
    )


def make_book(profile, **overrides):
    data = {
        "title": "Kokoro",
        "author": "Natsume Soseki",
        "format_type": "PHYSICAL",
        "sunflower_variant": "CLASSIC",
        "total_pages": 264,
    }
    data.update(overrides)
    return BookGarden.objects.create(profile=profile, **data)


class GardenTestCase(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.profile = make_profile()
        cls.other = make_profile()

    def as_profile(self, profile=None):
        return {"HTTP_X_PROFILE_ID": str((profile or self.profile).id)}

    def get(self, url=LIST_URL, profile=None, **params):
        return self.client.get(url, params, **self.as_profile(profile))

    def post(self, body, profile=None):
        return self.client.post(
            LIST_URL, body, content_type="application/json", **self.as_profile(profile)
        )

    def patch(self, book_id, body, profile=None):
        return self.client.patch(
            detail_url(book_id), body, content_type="application/json", **self.as_profile(profile)
        )


PHYSICAL = {
    "title": "Kokoro",
    "author": "Natsume Soseki",
    "format_type": "PHYSICAL",
    "sunflower_variant": "SOLAR",
    "total_pages": 264,
}
EPUB = {
    "title": "Walden",
    "author": "Henry David Thoreau",
    "format_type": "EPUB",
    "sunflower_variant": "AUTUMN",
}


class AuthenticationTests(GardenTestCase):
    def test_every_endpoint_requires_the_profile_header(self):
        book = make_book(self.profile)
        self.assertEqual(self.client.get(LIST_URL).status_code, 401)
        self.assertEqual(
            self.client.post(LIST_URL, PHYSICAL, content_type="application/json").status_code, 401
        )
        self.assertEqual(
            self.client.patch(
                detail_url(book.id), {"title": "x"}, content_type="application/json"
            ).status_code,
            401,
        )


class CreateTests(GardenTestCase):
    def test_plants_a_physical_book_at_zero_progress(self):
        response = self.post(PHYSICAL)
        self.assertEqual(response.status_code, 201)
        data = response.json()
        self.assertEqual(data["title"], "Kokoro")
        self.assertEqual(data["format_type"], "PHYSICAL")
        self.assertEqual(data["sunflower_variant"], "SOLAR")
        self.assertEqual(data["status"], "ACTIVE")
        self.assertEqual(data["growth_stage"], "SEED_1")
        self.assertEqual(data["progress_percentage"], 0)
        self.assertEqual(data["total_pages"], 264)
        self.assertEqual(data["current_page"], 0)
        self.assertIsNone(data["last_epub_cfi"])
        self.assertIsNone(data["completed_at"])
        book = BookGarden.objects.get(pk=data["id"])
        self.assertEqual(book.profile_id, self.profile.id)

    def test_plants_an_epub_book_without_pages(self):
        response = self.post(EPUB)
        self.assertEqual(response.status_code, 201)
        self.assertIsNone(response.json()["total_pages"])

    def test_epub_ignores_total_pages(self):
        response = self.post({**EPUB, "total_pages": 300})
        self.assertEqual(response.status_code, 201)
        self.assertIsNone(response.json()["total_pages"])

    def test_physical_requires_a_positive_integer_total_pages(self):
        for pages in (None, 0, -5, "abc", 1.5, 100_001):
            with self.subTest(pages=pages):
                self.assertEqual(self.post({**PHYSICAL, "total_pages": pages}).status_code, 400)
        body = {k: v for k, v in PHYSICAL.items() if k != "total_pages"}
        self.assertEqual(self.post(body).status_code, 400)
        self.assertEqual(BookGarden.objects.count(), 0)

    def test_rejects_invalid_fields(self):
        invalid = [
            {**PHYSICAL, "title": ""},
            {**PHYSICAL, "title": "   "},
            {**PHYSICAL, "title": "x" * 256},
            {**PHYSICAL, "author": ""},
            {**PHYSICAL, "author": "x" * 256},
            {**PHYSICAL, "format_type": "PDF"},
            {**PHYSICAL, "sunflower_variant": "ROSE"},
            {**PHYSICAL, "id": "no-es-uuid"},
            {k: v for k, v in PHYSICAL.items() if k != "sunflower_variant"},
            {},
        ]
        for body in invalid:
            with self.subTest(body=body):
                self.assertEqual(self.post(body).status_code, 400)
        self.assertEqual(BookGarden.objects.count(), 0)

    def test_the_client_cannot_set_progress_stage_or_status(self):
        response = self.post(
            {
                **PHYSICAL,
                "progress_percentage": 100,
                "growth_stage": "BLOOM_4",
                "status": "BLOOMED",
                "current_page": 264,
                "profile": str(self.other.id),
            }
        )
        self.assertEqual(response.status_code, 201)
        book = BookGarden.objects.get(pk=response.json()["id"])
        self.assertEqual(book.progress_percentage, 0)
        self.assertEqual(book.growth_stage, "SEED_1")
        self.assertEqual(book.status, "ACTIVE")
        self.assertEqual(book.current_page, 0)
        self.assertEqual(book.profile_id, self.profile.id)

    def test_title_and_author_are_trimmed(self):
        response = self.post({**PHYSICAL, "title": "  Kokoro  ", "author": " Soseki "})
        self.assertEqual(response.json()["title"], "Kokoro")
        self.assertEqual(response.json()["author"], "Soseki")

    def test_client_uuid_is_used_as_the_book_id(self):
        book_id = uuid.uuid4()
        response = self.post({**PHYSICAL, "id": str(book_id)})
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["id"], str(book_id))

    def test_replaying_the_same_id_is_idempotent_and_does_not_modify_the_book(self):
        book_id = uuid.uuid4()
        self.post({**PHYSICAL, "id": str(book_id)})
        replay = self.post({**EPUB, "id": str(book_id), "title": "Otro titulo"})
        self.assertEqual(replay.status_code, 200)
        self.assertEqual(replay.json()["title"], "Kokoro")
        self.assertEqual(BookGarden.objects.filter(pk=book_id).count(), 1)
        self.assertEqual(BookGarden.objects.get(pk=book_id).format_type, "PHYSICAL")

    def test_an_id_that_belongs_to_another_profile_is_a_conflict_and_leaks_nothing(self):
        foreign = make_book(self.other, title="Secreto")
        response = self.post({**PHYSICAL, "id": str(foreign.id)})
        self.assertEqual(response.status_code, 409)
        self.assertNotIn("Secreto", response.content.decode())
        foreign.refresh_from_db()
        self.assertEqual(foreign.title, "Secreto")
        self.assertEqual(foreign.profile_id, self.other.id)


class ListTests(GardenTestCase):
    def test_lists_only_the_books_of_the_profile_newest_first(self):
        first = make_book(self.profile, title="Primero")
        second = make_book(self.profile, title="Segundo")
        make_book(self.other, title="Ajeno")
        # El reloj de Windows puede dar el mismo created_at a libros seguidos.
        now = timezone.now()
        BookGarden.objects.filter(pk=first.pk).update(created_at=now - timedelta(days=1))
        BookGarden.objects.filter(pk=second.pk).update(created_at=now)
        response = self.get()
        self.assertEqual(response.status_code, 200)
        self.assertEqual([b["id"] for b in response.json()], [str(second.id), str(first.id)])

    def test_empty_garden_is_an_empty_list(self):
        self.assertEqual(self.get().json(), [])

    def test_filters_by_status(self):
        active = make_book(self.profile, title="A")
        make_book(self.profile, title="B", status="FALLOW")
        make_book(
            self.profile,
            title="C",
            status="BLOOMED",
            progress_percentage=Decimal("100"),
            completed_at=timezone.now(),
        )
        self.assertEqual([b["id"] for b in self.get(status="ACTIVE").json()], [str(active.id)])
        self.assertEqual([b["title"] for b in self.get(status="FALLOW").json()], ["B"])
        self.assertEqual([b["title"] for b in self.get(status="BLOOMED").json()], ["C"])
        self.assertEqual(len(self.get().json()), 3)

    def test_rejects_an_unknown_status_filter(self):
        self.assertEqual(self.get(status="DELETED").status_code, 400)

    def test_progress_is_serialized_as_a_number_with_the_derived_stage(self):
        make_book(self.profile, progress_percentage=Decimal("45.50"))
        item = self.get().json()[0]
        self.assertEqual(item["progress_percentage"], 45.5)
        self.assertEqual(item["growth_stage"], "STEM_2")


class UpdateTests(GardenTestCase):
    def setUp(self):
        self.book = make_book(self.profile)

    def test_puts_a_book_in_fallow_without_losing_progress(self):
        self.book.progress_percentage = Decimal("33.00")
        self.book.current_page = 87
        self.book.save()
        response = self.patch(self.book.id, {"status": "FALLOW"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "FALLOW")
        self.book.refresh_from_db()
        self.assertEqual(self.book.progress_percentage, Decimal("33.00"))
        self.assertEqual(self.book.current_page, 87)
        self.assertEqual(self.book.growth_stage, "STEM_2")

    def test_restores_a_book_from_fallow(self):
        self.book.status = "FALLOW"
        self.book.save()
        response = self.patch(self.book.id, {"status": "ACTIVE"})
        self.assertEqual(response.json()["status"], "ACTIVE")

    def test_restoring_a_book_that_reached_100_makes_it_bloomed(self):
        self.book.status = "FALLOW"
        self.book.progress_percentage = Decimal("100")
        self.book.save()
        response = self.patch(self.book.id, {"status": "ACTIVE"})
        self.assertEqual(response.json()["status"], "BLOOMED")

    def test_a_bloomed_book_cannot_be_put_in_fallow(self):
        self.book.status = "BLOOMED"
        self.book.progress_percentage = Decimal("100")
        self.book.save()
        self.assertEqual(self.patch(self.book.id, {"status": "FALLOW"}).status_code, 400)
        self.book.refresh_from_db()
        self.assertEqual(self.book.status, "BLOOMED")

    def test_status_cannot_be_set_to_bloomed_or_growing_by_the_client(self):
        for value in ("BLOOMED", "GROWING", "DELETED"):
            with self.subTest(status=value):
                self.assertEqual(self.patch(self.book.id, {"status": value}).status_code, 400)
        self.book.refresh_from_db()
        self.assertEqual(self.book.status, "ACTIVE")

    def test_updates_title_and_author(self):
        response = self.patch(self.book.id, {"title": " Nuevo ", "author": "Otro"})
        self.assertEqual(response.status_code, 200)
        self.book.refresh_from_db()
        self.assertEqual((self.book.title, self.book.author), ("Nuevo", "Otro"))

    def test_rejects_immutable_fields_and_changes_nothing(self):
        for field, value in {
            "progress_percentage": 100,
            "growth_stage": "BLOOM_4",
            "current_page": 264,
            "total_pages": 10,
            "format_type": "EPUB",
            "sunflower_variant": "AUTUMN",
            "last_epub_cfi": "epubcfi(/6/2)",
            "profile": str(self.other.id),
            "id": str(uuid.uuid4()),
            "completed_at": "2026-01-01T00:00:00Z",
        }.items():
            with self.subTest(field=field):
                response = self.patch(self.book.id, {"title": "Cambio", field: value})
                self.assertEqual(response.status_code, 400)
        self.book.refresh_from_db()
        self.assertEqual(self.book.title, "Kokoro")
        self.assertEqual(self.book.progress_percentage, 0)
        self.assertEqual(self.book.profile_id, self.profile.id)

    def test_rejects_empty_and_blank_updates(self):
        self.assertEqual(self.patch(self.book.id, {}).status_code, 400)
        self.assertEqual(self.patch(self.book.id, {"title": ""}).status_code, 400)

    def test_another_profiles_book_is_404_and_untouched(self):
        response = self.patch(self.book.id, {"title": "Hackeado"}, profile=self.other)
        self.assertEqual(response.status_code, 404)
        self.book.refresh_from_db()
        self.assertEqual(self.book.title, "Kokoro")

    def test_unknown_book_is_404(self):
        self.assertEqual(self.patch(uuid.uuid4(), {"title": "x"}).status_code, 404)

    def test_repeating_a_patch_is_idempotent(self):
        first = self.patch(self.book.id, {"status": "FALLOW"}).json()
        second = self.patch(self.book.id, {"status": "FALLOW"}).json()
        self.assertEqual(first["status"], second["status"])

    def test_only_patch_is_allowed_on_the_detail_route(self):
        headers = self.as_profile()
        self.assertEqual(self.client.get(detail_url(self.book.id), **headers).status_code, 405)
        self.assertEqual(self.client.delete(detail_url(self.book.id), **headers).status_code, 405)
        self.assertEqual(
            self.client.put(
                detail_url(self.book.id), PHYSICAL, content_type="application/json", **headers
            ).status_code,
            405,
        )
        self.assertTrue(BookGarden.objects.filter(pk=self.book.id).exists())
