"""Concurrencia y desconexion del cliente (necesitan transacciones reales, no TestCase)."""

import asyncio
import contextlib
import threading

from asgiref.sync import sync_to_async
from django.db import connection
from django.test import TransactionTestCase

from apps.ai_companion import services, streaming
from apps.ai_companion.models import ReflectionChat
from apps.ai_companion.tests.fakes import FakeGemini, make_profile, make_session


class CompanionTransactionTestCase(TransactionTestCase):
    def setUp(self):
        self.profile = make_profile()
        self.session = make_session(self.profile)
        self.chat, _ = services.start_chat(self.profile, self.session.id)


class DoubleSendTests(CompanionTransactionTestCase):
    def race(self, workers=6):
        barrier = threading.Barrier(workers)
        results = [None] * workers

        def attempt(index):
            try:
                barrier.wait()
                results[index] = services.claim_reply(self.profile, self.chat.id, f"envio {index}")
            except Exception as exc:  # noqa: BLE001
                results[index] = exc
            finally:
                connection.close()

        threads = [threading.Thread(target=attempt, args=(i,)) for i in range(workers)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        return results

    def test_simultaneous_sends_reserve_the_chat_only_once(self):
        results = self.race()
        claims = [r for r in results if isinstance(r, services.ReplyClaim)]
        rejected = [r for r in results if isinstance(r, services.ReplyInProgress)]
        self.assertEqual(len(claims), 1)
        self.assertEqual(len(rejected), len(results) - 1)

    def test_the_chat_can_be_reserved_again_once_the_winner_releases_it(self):
        winner = next(r for r in self.race(workers=3) if isinstance(r, services.ReplyClaim))
        services.release_claim(winner.chat_id, winner.token)
        again = services.claim_reply(self.profile, self.chat.id, "otro")
        self.assertEqual(again.turn, 1)


class DisconnectTests(CompanionTransactionTestCase):
    async def run_until_disconnect(self, fake):
        claim = await sync_to_async(services.claim_reply)(self.profile, self.chat.id, "hola")
        started = asyncio.Event()

        async def consume():
            from unittest import mock

            with mock.patch.object(streaming, "get_gemini_client", return_value=fake):
                async for _ in streaming.stream_reply_events(claim):
                    started.set()

        task = asyncio.create_task(consume())
        await asyncio.wait_for(started.wait(), timeout=5)
        task.cancel()  # el servidor ASGI cancela la tarea cuando el cliente se desconecta
        with contextlib.suppress(asyncio.CancelledError):
            await task

    async def test_a_client_disconnect_cancels_the_generator_saves_nothing_and_frees_the_lock(self):
        fake = FakeGemini("hang")
        await self.run_until_disconnect(fake)

        self.assertTrue(fake.cancelled, "el generador de Gemini debe cancelarse")
        chat = await ReflectionChat.objects.aget(pk=self.chat.pk)
        self.assertEqual((chat.turn_count, chat.is_closed), (1, False))
        self.assertIsNone(chat.pending_since)
        self.assertEqual(await chat.messages.acount(), 1)
        # El lector puede reintentar de inmediato.
        again = await sync_to_async(services.claim_reply)(self.profile, self.chat.id, "hola")
        self.assertEqual(again.turn, 1)
