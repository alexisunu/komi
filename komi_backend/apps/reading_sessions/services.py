"""Cierre de sesiones de lectura (CU-04, SRS 17 puntos 8 y 17).

Todo ocurre en una transaccion que bloquea primero el perfil y luego el libro. Bloquear el
perfil serializa los cierres del mismo lector: un reintento concurrente con el mismo UUID de
sesion ve la sesion ya guardada y devuelve su resultado sin duplicar nada.
"""

from dataclasses import dataclass
from decimal import ROUND_DOWN, Decimal

from django.db import transaction
from django.http import Http404
from django.utils import timezone
from rest_framework.exceptions import APIException, ValidationError

from apps.garden.models import BookGarden
from apps.profiles.models import ReaderProfile
from apps.reading_sessions import streak_engine
from apps.reading_sessions.models import ReadingSession

SessionStatus = ReadingSession.SessionStatus
ZERO = Decimal("0.00")
HUNDRED = Decimal("100.00")
TWO_PLACES = Decimal("0.01")


class SessionConflict(APIException):
    status_code = 409
    default_detail = "La sesion no se puede registrar."
    default_code = "conflict"


@dataclass
class CompletionResult:
    session: ReadingSession
    book: BookGarden
    profile: ReaderProfile
    created: bool
    just_bloomed: bool


def _page_progress(page: int, total_pages: int) -> Decimal:
    """Porcentaje de un libro fisico, truncado a 2 decimales.

    Se trunca (no se redondea) para que el 100% solo se alcance en la ultima pagina.
    """
    return (Decimal(page) * 100 / Decimal(total_pages)).quantize(TWO_PLACES, rounding=ROUND_DOWN)


def _required(data: dict, field: str, message: str):
    if field not in data:
        raise ValidationError({field: message})
    return data[field]


def _new_progress(book: BookGarden, data: dict) -> tuple[Decimal, int, bool]:
    """Devuelve (progreso nuevo, pagina nueva, el cliente avanzo respecto al guardado).

    El progreso es monotonico: nunca baja del guardado (SRS 17, punto 8).
    """
    previous = book.progress_percentage
    if book.format_type == BookGarden.FormatType.PHYSICAL:
        page = _required(data, "current_page", "Es obligatorio para un libro fisico.")
        if book.total_pages is None or page > book.total_pages:
            raise ValidationError({"current_page": "Supera el total de paginas del libro."})
        reported = _page_progress(page, book.total_pages)
        return max(previous, reported), max(book.current_page, page), reported >= previous

    reported = _required(data, "progress_percentage", "Es obligatorio para un libro EPUB.")
    reported = Decimal(reported).quantize(TWO_PLACES, rounding=ROUND_DOWN)
    return max(previous, min(reported, HUNDRED)), book.current_page, reported >= previous


def _validated_status(data: dict, new_progress: Decimal, previous: Decimal) -> SessionStatus:
    """Estado final derivado de las duraciones; el servidor no confia en el del cliente.

    COMPLETED exige tiempo completo; EARLY_VALID, al menos el 50% o llegar al 100% del libro
    (RF-02, FA-3.3). Una sesion que no alcanza ninguna de las dos no se registra como valida.
    """
    actual, planned = data["actual_duration_sec"], data["planned_duration_sec"]
    if actual >= planned:
        return SessionStatus.COMPLETED
    if actual * 2 >= planned or (new_progress >= HUNDRED and previous < HUNDRED):
        return SessionStatus.EARLY_VALID
    raise ValidationError(
        {"session_status": "La sesion no alcanza el 50% de la duracion programada."}
    )


def complete_session(profile_id, data: dict) -> CompletionResult:
    with transaction.atomic():
        profile = ReaderProfile.objects.select_for_update().get(pk=profile_id)

        existing = ReadingSession.objects.select_related("book").filter(pk=data["id"]).first()
        if existing is not None:
            if existing.book.profile_id != profile.id:
                raise SessionConflict("Identificador de sesion no disponible.")
            return CompletionResult(existing, existing.book, profile, False, False)

        book = (
            BookGarden.objects.select_for_update()
            .filter(pk=data["book_id"], profile=profile)
            .first()
        )
        if book is None:
            raise Http404

        claimed_valid = data["session_status"] != SessionStatus.INVALIDATED_GRACE_EXPIRED
        if not claimed_valid:
            return _save_invalidated(profile, book, data)
        return _save_valid(profile, book, data)


def _save_invalidated(profile, book, data) -> CompletionResult:
    """Sesion invalidada por el periodo de gracia: se registra sin tocar progreso ni racha."""
    session = ReadingSession.objects.create(
        id=data["id"],
        book=book,
        planned_duration_sec=data["planned_duration_sec"],
        actual_duration_sec=data["actual_duration_sec"],
        started_at_local=data["started_at_local"],
        session_status=SessionStatus.INVALIDATED_GRACE_EXPIRED,
        progress_delta=ZERO,
        granted_solar_bonus=False,
    )
    return CompletionResult(session, book, profile, True, False)


def _save_valid(profile, book, data) -> CompletionResult:
    if book.status == BookGarden.Status.FALLOW:
        raise SessionConflict("El libro esta en barbecho; restauralo para leerlo.")
    if book.progress_percentage >= HUNDRED:
        raise SessionConflict("El libro ya florecio.")

    previous = book.progress_percentage
    new_progress, new_page, advanced = _new_progress(book, data)
    status = _validated_status(data, new_progress, previous)
    delta = new_progress - previous

    just_bloomed = new_progress >= HUNDRED
    book.progress_percentage = new_progress
    book.current_page = new_page
    # El CFI solo se actualiza si la lectura no retrocedio: uno atrasado no pisa uno mas nuevo.
    if book.format_type == BookGarden.FormatType.EPUB and advanced and data.get("last_epub_cfi"):
        book.last_epub_cfi = data["last_epub_cfi"]
    if just_bloomed:
        book.status = BookGarden.Status.BLOOMED
        book.completed_at = timezone.now()
    book.save()

    excerpt = data.get("extracted_epub_excerpt")
    session = ReadingSession.objects.create(
        id=data["id"],
        book=book,
        planned_duration_sec=data["planned_duration_sec"],
        actual_duration_sec=data["actual_duration_sec"],
        started_at_local=data["started_at_local"],
        session_status=status,
        progress_delta=delta,
        granted_solar_bonus=streak_engine.grants_solar_bonus(book.format_type, delta, status),
        extracted_epub_excerpt=(
            excerpt if book.format_type == BookGarden.FormatType.EPUB and excerpt else None
        ),
    )

    state = streak_engine.StreakState(
        profile.current_streak, profile.longest_streak, profile.last_valid_session_date
    )
    updated = streak_engine.apply_session_if_valid(state, session.started_at_local, status)
    if updated != state:
        profile.current_streak = updated.current
        profile.longest_streak = updated.longest
        profile.last_valid_session_date = updated.last_date
        profile.save(update_fields=["current_streak", "longest_streak", "last_valid_session_date"])

    return CompletionResult(session, book, profile, True, just_bloomed)
