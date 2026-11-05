"""Charla reflexiva con Komi (CU-05, SRS 17 puntos 3, 4 y 20).

Reglas:
- El Turno 1 es local y se guarda al iniciar la charla (cero llamadas a Gemini).
- Un envio del lector reserva la charla (`pending_since`) antes de llamar a Gemini: un segundo
  envio concurrente recibe 409 sin gastar cuota. La reserva se libera al terminar el envio,
  bien o mal; el vencimiento (90 s) solo cubre un proceso caido.
- Los mensajes (lector y Komi) y `turn_count` se guardan juntos, en una transaccion, solo si el
  streaming termino bien. Con cualquier error no se guarda nada y `turn_count` no sube.
- Al guardar el turno 5 la charla se cierra (`is_closed`) y se guarda la semilla, si la hay.
"""

import logging
from dataclasses import dataclass
from datetime import timedelta

from django.db import IntegrityError, transaction
from django.db.models import Q
from django.http import Http404
from django.utils import timezone
from rest_framework.exceptions import APIException

from apps.ai_companion.models import ReflectionChat, ReflectionMessage
from apps.ai_companion.prompt_builder import build_komi_system_prompt, build_opening_message
from apps.reading_sessions import streak_engine
from apps.reading_sessions.models import ReadingSession

logger = logging.getLogger(__name__)

MAX_TURNS = 5
LOCK_TTL = timedelta(seconds=90)
MAX_KEY_TAKEAWAY_CHARS = 500
Sender = ReflectionMessage.Sender


class ChatConflict(APIException):
    status_code = 409
    default_detail = "La charla no admite esta operacion."
    default_code = "chat_conflict"

    def __init__(self, detail=None, code=None):
        # El cuerpo lleva un `code` estable para que el cliente distinga los casos.
        code = code or self.default_code
        super().__init__({"detail": detail or self.default_detail, "code": code}, code)


class ChatClosed(ChatConflict):
    default_detail = "La charla ya termino."
    default_code = "chat_closed"


class ReplyInProgress(ChatConflict):
    default_detail = "Komi todavia esta respondiendo; espera a que termine."
    default_code = "reply_in_progress"


class TurnMismatch(ChatConflict):
    default_detail = "El turno indicado no coincide con el estado de la charla."
    default_code = "turn_mismatch"


class SessionNotEligible(ChatConflict):
    default_detail = "Solo las sesiones validas tienen charla."
    default_code = "session_invalid"


class ClaimLost(Exception):
    """La reserva vencio o la charla cambio mientras Komi respondia."""


@dataclass(frozen=True)
class ReplyClaim:
    chat_id: object
    token: object  # marca de tiempo de la reserva: identifica al dueno del candado
    turn: int  # turno de Komi al que responde el lector
    content: str
    system_prompt: str
    history: list
    extract_seed: bool


def start_chat(profile, session_id) -> tuple[ReflectionChat, bool]:
    """Crea la charla con el Turno 1 local. Idempotente: devuelve la existente si ya hay una."""
    session = (
        ReadingSession.objects.select_related("book")
        .filter(pk=session_id, book__profile=profile)
        .first()
    )
    if session is None:
        raise Http404
    if not streak_engine.is_valid_status(session.session_status):
        raise SessionNotEligible()

    existing = ReflectionChat.objects.filter(session=session).first()
    if existing is not None:
        return existing, False
    try:
        with transaction.atomic():
            chat = ReflectionChat.objects.create(session=session)
            ReflectionMessage.objects.create(
                chat=chat,
                sender=Sender.KOMI_AI,
                content=build_opening_message(session.book, profile),
                turn_number=1,
            )
    except IntegrityError:
        # Otra peticion creo la charla de esta sesion al mismo tiempo.
        return ReflectionChat.objects.get(session=session), False
    return chat, True


def release_claim(chat_id, token) -> None:
    """Libera la reserva solo si sigue siendo nuestra. Idempotente."""
    ReflectionChat.objects.filter(pk=chat_id, pending_since=token).update(pending_since=None)


def claim_reply(profile, chat_id, content: str, turn: int | None = None) -> ReplyClaim:
    """Valida el envio y reserva la charla. Lanza 404 o 409 (cerrada, en curso, turno)."""
    chat = (
        ReflectionChat.objects.select_related("session__book")
        .filter(pk=chat_id, session__book__profile=profile)
        .first()
    )
    if chat is None:
        raise Http404
    if chat.is_closed or chat.turn_count >= MAX_TURNS:
        raise ChatClosed()
    if turn is not None and turn != chat.turn_count:
        raise TurnMismatch()

    now = timezone.now()
    reserved = ReflectionChat.objects.filter(
        Q(pending_since__isnull=True) | Q(pending_since__lt=now - LOCK_TTL),
        pk=chat.pk,
        is_closed=False,
        turn_count=chat.turn_count,
    ).update(pending_since=now)
    if not reserved:
        current = ReflectionChat.objects.get(pk=chat.pk)
        if current.is_closed or current.turn_count >= MAX_TURNS:
            raise ChatClosed()
        raise ReplyInProgress()

    try:
        history = [(m.sender, m.content) for m in chat.messages.all()]
        history.append((Sender.USER, content))
        next_turn = chat.turn_count + 1
        return ReplyClaim(
            chat_id=chat.pk,
            token=now,
            turn=chat.turn_count,
            content=content,
            system_prompt=build_komi_system_prompt(chat.session, profile, next_turn),
            history=history,
            extract_seed=next_turn >= MAX_TURNS,
        )
    except Exception:
        release_claim(chat.pk, now)
        raise


def finalize_reply(claim: ReplyClaim, finished) -> dict:
    """Guarda el intercambio completo. Solo se llama cuando el streaming termino bien."""
    with transaction.atomic():
        chat = ReflectionChat.objects.select_for_update().get(pk=claim.chat_id)
        if chat.pending_since != claim.token or chat.turn_count != claim.turn or chat.is_closed:
            raise ClaimLost()

        text = finished.text.strip()
        ReflectionMessage.objects.create(
            chat=chat, sender=Sender.USER, content=claim.content, turn_number=claim.turn
        )
        ReflectionMessage.objects.create(
            chat=chat, sender=Sender.KOMI_AI, content=text, turn_number=claim.turn + 1
        )
        chat.turn_count = claim.turn + 1
        chat.pending_since = None
        if chat.turn_count >= MAX_TURNS:
            chat.is_closed = True
            seed = (finished.key_takeaway or "").strip()
            chat.key_takeaway = seed[:MAX_KEY_TAKEAWAY_CHARS] or None
        chat.save(update_fields=["turn_count", "pending_since", "is_closed", "key_takeaway"])

    return {
        "turn": chat.turn_count,
        "is_closed": chat.is_closed,
        "key_takeaway": chat.key_takeaway,
        "content": text,
    }
