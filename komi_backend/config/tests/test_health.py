from unittest import mock

from django.test import TestCase, override_settings

from config import health

ORIGIN = "https://komi.pages.dev"
LIVE = "/api/v1/health/"
DB = "/api/v1/health/db/"


class LivenessTests(TestCase):
    def test_answers_ok_without_authentication(self):
        response = self.client.get(LIVE)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok"})

    def test_is_never_cached(self):
        self.assertEqual(self.client.get(LIVE)["Cache-Control"], "no-store")
        self.assertEqual(self.client.get(DB)["Cache-Control"], "no-store")

    def test_does_not_touch_the_database(self):
        with self.assertNumQueries(0):
            self.client.get(LIVE)

    def test_only_get_is_allowed(self):
        for method in ("post", "put", "patch", "delete"):
            with self.subTest(method=method):
                self.assertEqual(getattr(self.client, method)(LIVE).status_code, 405)
                self.assertEqual(getattr(self.client, method)(DB).status_code, 405)

    def test_does_not_expose_data_or_settings(self):
        body = self.client.get(LIVE).content.decode() + self.client.get(DB).content.decode()
        for forbidden in ("version", "host", "user", "password", "gemini", "database_url"):
            self.assertNotIn(forbidden, body.lower().replace('"database"', ""))

    @override_settings(CORS_ALLOWED_ORIGINS=[ORIGIN])
    def test_the_frontend_origin_can_read_it_and_others_cannot(self):
        ok = self.client.get(LIVE, HTTP_ORIGIN=ORIGIN)
        self.assertEqual(ok["Access-Control-Allow-Origin"], ORIGIN)
        other = self.client.get(LIVE, HTTP_ORIGIN="https://evil.example.com")
        self.assertNotIn("Access-Control-Allow-Origin", other)


class DatabaseCheckTests(TestCase):
    def test_reports_ok_when_the_database_answers(self):
        response = self.client.get(DB)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok", "database": "ok"})

    def test_reports_503_when_the_database_fails(self):
        with mock.patch.object(health, "_ping_database", side_effect=RuntimeError("down")):
            response = self.client.get(DB)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json(), {"status": "error", "database": "unavailable"})

    def test_a_database_failure_never_leaks_details_and_is_logged_by_type(self):
        secret = "host-secreto.supabase.com password=clave"
        with (
            mock.patch.object(health, "_ping_database", side_effect=RuntimeError(secret)),
            self.assertLogs("config.health", level="ERROR") as logs,
        ):
            response = self.client.get(DB)
        self.assertNotIn("host-secreto", response.content.decode())
        self.assertNotIn("host-secreto", " ".join(logs.output))
        self.assertIn("RuntimeError", " ".join(logs.output))

    def test_liveness_still_answers_when_the_database_is_down(self):
        with mock.patch.object(health, "_ping_database", side_effect=RuntimeError("down")):
            self.assertEqual(self.client.get(LIVE).status_code, 200)
