from django.conf import settings
from django.test import TestCase, override_settings

ORIGIN = "https://komi.example.com"
URL = "/api/v1/profile/onboarding/"


def preflight(client, origin=ORIGIN, method="POST", headers="content-type, x-profile-id"):
    return client.options(
        URL,
        HTTP_ORIGIN=origin,
        HTTP_ACCESS_CONTROL_REQUEST_METHOD=method,
        HTTP_ACCESS_CONTROL_REQUEST_HEADERS=headers,
    )


@override_settings(CORS_ALLOWED_ORIGINS=[ORIGIN])
class CorsTests(TestCase):
    def test_preflight_from_the_frontend_allows_the_profile_header(self):
        response = preflight(self.client)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Access-Control-Allow-Origin"], ORIGIN)
        allowed = response["Access-Control-Allow-Headers"].lower()
        self.assertIn("x-profile-id", allowed)
        self.assertIn("content-type", allowed)

    def test_preflight_allows_patch_for_the_garden_endpoint(self):
        response = preflight(self.client, method="PATCH")
        self.assertIn("PATCH", response["Access-Control-Allow-Methods"])

    def test_actual_request_from_the_frontend_gets_the_origin_header(self):
        response = self.client.get(URL, HTTP_ORIGIN=ORIGIN)
        self.assertEqual(response["Access-Control-Allow-Origin"], ORIGIN)

    def test_other_origins_get_no_cors_headers(self):
        for origin in ("https://evil.example.com", "http://komi.example.com", "null"):
            with self.subTest(origin=origin):
                response = preflight(self.client, origin=origin)
                self.assertNotIn("Access-Control-Allow-Origin", response)
                response = self.client.get(URL, HTTP_ORIGIN=origin)
                self.assertNotIn("Access-Control-Allow-Origin", response)

    def test_credentials_are_never_allowed(self):
        response = preflight(self.client)
        self.assertNotIn("Access-Control-Allow-Credentials", response)


class CorsDefaultsTests(TestCase):
    def test_no_origins_are_allowed_unless_configured(self):
        with override_settings(CORS_ALLOWED_ORIGINS=[]):
            response = preflight(self.client)
            self.assertNotIn("Access-Control-Allow-Origin", response)

    def test_settings_declare_the_header_and_no_wildcard(self):
        self.assertIn("x-profile-id", settings.CORS_ALLOW_HEADERS)
        self.assertFalse(getattr(settings, "CORS_ALLOW_ALL_ORIGINS", False))
        self.assertFalse(settings.CORS_ALLOW_CREDENTIALS)
        self.assertNotIn("*", settings.CORS_ALLOWED_ORIGINS)
