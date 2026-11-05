import logging
import uuid

from django.db import connection
from django.test import TestCase, override_settings
from django.urls import path
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.profiles.models import ReaderProfile


class WhoAmIView(APIView):
    """Vista de prueba protegida con la configuracion por defecto de DRF."""

    def get(self, request):
        same = request.user.profile is request.auth
        return Response({"profile_id": str(request.auth.id), "same": same})


urlpatterns = [path("whoami/", WhoAmIView.as_view())]

HEADER = "HTTP_X_PROFILE_ID"


class ListHandler(logging.Handler):
    def __init__(self):
        super().__init__(level=logging.DEBUG)
        self.messages = []

    def emit(self, record):
        self.messages.append(record.getMessage())


@override_settings(ROOT_URLCONF=__name__)
class ProfileHeaderAuthenticationTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.profile = ReaderProfile.objects.create(
            preferred_moment="NIGHT", ai_reflection_style="DEEP_ANALYSIS"
        )

    def test_valid_header_identifies_the_profile(self):
        response = self.client.get("/whoami/", **{HEADER: str(self.profile.id)})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"profile_id": str(self.profile.id), "same": True})

    def test_header_is_case_insensitive_and_tolerates_whitespace(self):
        response = self.client.get("/whoami/", headers={"x-profile-id": f" {self.profile.id} "})
        self.assertEqual(response.status_code, 200)

    def test_missing_header_is_401(self):
        response = self.client.get("/whoami/")
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response["WWW-Authenticate"], "X-Profile-Id")

    def test_empty_header_is_401(self):
        self.assertEqual(self.client.get("/whoami/", **{HEADER: ""}).status_code, 401)

    def test_malformed_uuid_is_401(self):
        for value in ("abc", "1234", "'; DROP TABLE x;--", "g" * 36):
            with self.subTest(value=value):
                self.assertEqual(self.client.get("/whoami/", **{HEADER: value}).status_code, 401)

    def test_unknown_profile_is_401_with_the_same_body_as_a_malformed_one(self):
        unknown = self.client.get("/whoami/", **{HEADER: str(uuid.uuid4())})
        malformed = self.client.get("/whoami/", **{HEADER: "abc"})
        self.assertEqual(unknown.status_code, 401)
        self.assertEqual(unknown.json(), malformed.json())

    def test_cookies_and_sessions_are_not_an_authentication_method(self):
        self.client.cookies["sessionid"] = str(self.profile.id)
        self.assertEqual(self.client.get("/whoami/").status_code, 401)

    def test_the_uuid_is_never_written_to_logs_or_error_bodies(self):
        handler = ListHandler()
        root = logging.getLogger()
        previous_level = root.level
        root.addHandler(handler)
        root.setLevel(logging.DEBUG)
        known, unknown = str(self.profile.id), str(uuid.uuid4())
        try:
            connection.force_debug_cursor = True
            bodies = [
                self.client.get("/whoami/", **{HEADER: known}).content.decode(),
                self.client.get("/whoami/", **{HEADER: unknown}).content.decode(),
                self.client.get("/whoami/", **{HEADER: "abc"}).content.decode(),
                self.client.get("/whoami/").content.decode(),
            ]
        finally:
            connection.force_debug_cursor = False
            root.setLevel(previous_level)
            root.removeHandler(handler)
        logged = "\n".join(handler.messages)
        self.assertNotIn(known, logged)
        self.assertNotIn(unknown, logged)
        self.assertNotIn(unknown, "".join(bodies[1:]))
