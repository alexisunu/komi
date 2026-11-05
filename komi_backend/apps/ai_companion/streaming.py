"""Streaming SSE de la respuesta de Komi (RNF-03, SRS 17 punto 20).

Eventos (`text/event-stream`):
  chunk  {"text": "..."}                                       texto visible, en orden
  done   {"turn": n, "is_closed": bool, "key_takeaway": ..., "content": "..."}
  error  {"code": "...", "retry_after": n|null}                el texto parcial se descarta

Los errores previos al stream (404, 400, 409) son respuestas JSON normales. Cuando el stream
falla, el cliente recibe `error` y NO se guarda nada. No se registran prompts ni respuestas.
"""

import asyncio
import json
import logging

from asgiref.sync import sync_to_async
from django.core.exceptions import ImproperlyConfigured

from apps.ai_companion import services
from apps.ai_companion.gemini_client import (
    Finished,
    GeminiQuotaError,
    GeminiTruncatedError,
    GeminiUnavailableError,
    TextChunk,
    get_gemini_client,
)

logger = logging.getLogger(__name__)

STREAM_TIMEOUT_SEC = 60


def sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _error(code: str, retry_after=None) -> str:
    return sse("error", {"code": code, "retry_after": retry_after})


async def stream_reply_events(claim):
    """Generador asincrono del SSE. Su `finally` siempre libera la reserva de la charla."""
    finished = None
    try:
        client = get_gemini_client()
        async with asyncio.timeout(STREAM_TIMEOUT_SEC):
            async for event in client.stream_reply(
                claim.system_prompt, claim.history, extract_seed=claim.extract_seed
            ):
                if isinstance(event, TextChunk):
                    yield sse("chunk", {"text": event.text})
                elif isinstance(event, Finished):
                    finished = event
        if finished is None or not finished.text.strip():
            raise GeminiUnavailableError("Gemini no devolvio texto.")
        result = await sync_to_async(services.finalize_reply)(claim, finished)
        logger.info(
            "Charla: respuesta del turno %s generada con el modelo %s.",
            result["turn"],
            finished.model,
        )
        yield sse("done", result)
    except GeminiQuotaError as exc:
        retry = None if exc.retry_after is None else int(exc.retry_after)
        yield _error("quota_exceeded", retry)
    except GeminiTruncatedError:
        yield _error("truncated")
    except ImproperlyConfigured as exc:
        # El mensaje solo nombra variables faltantes, nunca valores; el cliente no lo recibe.
        logger.error("Charla: configuracion de Gemini incompleta. %s", exc)
        yield _error("unavailable")
    except GeminiUnavailableError as exc:
        logger.error("Charla: Gemini no disponible (%s).", type(exc).__name__)
        yield _error("unavailable")
    except TimeoutError:
        logger.error("Charla: tiempo agotado esperando a Gemini.")
        yield _error("timeout")
    except services.ClaimLost:
        logger.warning("Charla: la reserva se perdio antes de guardar.")
        yield _error("conflict")
    except Exception as exc:
        logger.error("Charla: error inesperado (%s).", type(exc).__name__)
        yield _error("internal")
    finally:
        # shield: la liberacion termina aunque el cliente se desconecte (cancelacion).
        await asyncio.shield(sync_to_async(services.release_claim)(claim.chat_id, claim.token))
