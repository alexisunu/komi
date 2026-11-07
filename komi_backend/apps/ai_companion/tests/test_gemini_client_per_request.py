"""El cliente de Gemini es de una sola peticion (SRS 19.22).

`runserver` atiende cada peticion en un bucle de eventos nuevo (`async_to_sync`). Un cliente
compartido conserva conexiones del bucle anterior y la segunda peticion falla con
"Event loop is closed". Aqui se reproduce con un servidor HTTP local falso: sin red ni Gemini.
"""

import asyncio
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest import mock

from django.test import SimpleTestCase, override_settings
from google import genai
from google.genai import types

from apps.ai_companion import gemini_client
from apps.ai_companion.gemini_client import GeminiClient, TextChunk, get_gemini_client

BODY = (
    "data: "
    + json.dumps(
        {
            "candidates": [
                {"content": {"parts": [{"text": "hola"}], "role": "model"}, "finishReason": "STOP"}
            ]
        }
    )
    + "\r\n\r\n"
).encode()


class FakeGeminiApi(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"  # keep-alive, como la API real

    def do_POST(self):
        self.rfile.read(int(self.headers.get("Content-Length", 0)))
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Content-Length", str(len(BODY)))
        self.end_headers()
        self.wfile.write(BODY)

    def log_message(self, *args):
        pass


@override_settings(
    GEMINI_API_KEY="clave-falsa", GEMINI_PRIMARY_MODEL="principal", GEMINI_FALLBACK_MODEL="respaldo"
)
class OneClientPerRequestTests(SimpleTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), FakeGeminiApi)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.addClassCleanup(cls.server.server_close)
        cls.addClassCleanup(cls.server.shutdown)

    def setUp(self):
        url = f"http://127.0.0.1:{self.server.server_port}"
        self.created = []
        real = genai.Client

        def local_client(api_key=None, **kwargs):
            client = real(
                api_key=api_key,
                http_options=types.HttpOptions(base_url=url, api_version="v1beta"),
            )
            self.created.append(client)
            return client

        patcher = mock.patch.object(gemini_client.genai, "Client", local_client)
        patcher.start()
        self.addCleanup(patcher.stop)

    @staticmethod
    async def one_request():
        """Lo que hace una peticion del chat: cliente nuevo, respuesta y cierre."""
        client = get_gemini_client()
        try:
            events = [e async for e in client.stream_reply("sistema", [("USER", "hola")])]
        finally:
            await client.aclose()
        return [e.text for e in events if isinstance(e, TextChunk)]

    def test_requests_each_in_their_own_event_loop_all_succeed(self):
        for number in range(1, 6):
            with self.subTest(request=number):
                # asyncio.run abre y cierra un bucle: lo mismo que runserver por peticion.
                self.assertEqual(asyncio.run(self.one_request()), ["hola"])

    def test_a_shared_client_fails_on_the_second_loop_which_is_the_bug_being_fixed(self):
        shared = get_gemini_client()

        async def reuse():
            return [e async for e in shared.stream_reply("sistema", [("USER", "hola")])]

        asyncio.run(reuse())
        with self.assertRaises(gemini_client.GeminiUnavailableError):
            # Con un solo modelo de respaldo distinto el segundo intento tambien puede
            # reutilizar la conexion muerta; aqui basta con ver que el primer bucle ya
            # deja el cliente inservible para el siguiente.
            shared.fallback_model = shared.primary_model
            asyncio.run(reuse())

    def test_every_call_builds_a_new_client(self):
        first, second = get_gemini_client(), get_gemini_client()
        self.assertIsNot(first, second)
        self.assertEqual(len(self.created), 2)
        self.assertIsNot(first._client, second._client)

    def test_get_gemini_client_is_not_cached(self):
        self.assertFalse(hasattr(get_gemini_client, "cache_clear"))
        self.assertFalse(hasattr(get_gemini_client, "__wrapped__"))


class CloseTests(SimpleTestCase):
    def make(self, aclose):
        calls = []

        async def close():
            calls.append("cerrado")
            if aclose == "falla":
                raise RuntimeError("x")

        aio = mock.Mock(spec=[])
        aio.aclose = close
        client = GeminiClient(client=mock.Mock(aio=aio), primary_model="a", fallback_model="b")
        return client, calls

    async def test_aclose_closes_the_async_client(self):
        client, calls = self.make("ok")
        await client.aclose()
        self.assertEqual(calls, ["cerrado"])

    async def test_aclose_can_be_called_twice(self):
        client, calls = self.make("ok")
        await client.aclose()
        await client.aclose()
        self.assertEqual(calls, ["cerrado", "cerrado"])

    async def test_aclose_without_async_client_support_does_nothing(self):
        client = GeminiClient(
            client=mock.Mock(aio=mock.Mock(spec=[])), primary_model="a", fallback_model="b"
        )
        await client.aclose()
