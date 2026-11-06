"""Reglas de sesiones de lectura (CU-04, SRS 17 puntos 8 y 17).

Este modulo es la unica fuente de las reglas de sesion. `sessions/complete` y la sincronizacion
usan las mismas funciones:

- `evaluate_session`: decide estado, progreso, delta, Bono Solar y florecimiento. No escribe.
- `persist_session`: aplica el resultado al libro y crea la sesion.
- `lock_profile` y `find_existing_session`: bloqueo del perfil e idempotencia por UUID.

`strict=True` (complete) rechaza sesiones validas sobre libros en barbecho o florecidos.
`strict=False` (sync) las acepta, porque las sesiones son aditivas y no se pueden perder.
"""

from dataclasses import dataclass
from decimal import ROUND_DOWN, Decimal

from django.db import transaction
from django.http import Http404
from django.utils import timezone
from rest_framework.exceptions import APIException, ErrorDetail, ValidationError

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


@dataclass(frozen=True)
class SessionOutcome:
    """Resultado de evaluar una sesion contra el estado actual de su libro."""

    status: str
    delta: Decimal
    new_progress: Decimal
    new_page: int
    update_cfi: bool
    just_bloomed: bool
    granted_solar_bonus: bool

    @property
    def is_valid(self) -> bool:
        return streak_engine.is_valid_status(self.status)


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


def _reported_progress(book: BookGarden, data: dict) -> tuple[Decimal, int]:
    """(progreso que reporta la sesion, pagina), sin compararlo con el guardado del libro."""
    if book.format_type == BookGarden.FormatType.PHYSICAL:
        page = _required(data, "current_page", "Es obligatorio para un libro fisico.")
        if book.total_pages is None or page > book.total_pages:
            raise ValidationError({"current_page": "Supera el total de paginas del libro."})
        return _page_progress(page, book.total_pages), page

    reported = _required(data, "progress_percentage", "Es obligatorio para un libro EPUB.")
    return Decimal(reported).quantize(TWO_PLACES, rounding=ROUND_DOWN), 0


def _new_progress(book: BookGarden, data: dict) -> tuple[Decimal, int, bool]:
    """Devuelve (progreso nuevo, pagina nueva, el cliente avanzo respecto al guardado).

    El progreso es monotonico: nunca baja del guardado (SRS 17, punto 8).
    """
    previous = book.progress_percentage
    reported, page = _reported_progress(book, data)
    if book.format_type == BookGarden.FormatType.PHYSICAL:
        return max(previous, reported), max(book.current_page, page), reported >= previous
    return max(previous, min(reported, HUNDRED)), book.current_page, reported >= previous


def _validated_status(data: dict, new_progress: Decimal, previous: Decimal) -> str:
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
        {
            "session_status": ErrorDetail(
                "La sesion no alcanza el 50% de la duracion programada.",
                code="below_50_percent",
            )
        }
    )


def evaluate_session(
    book: BookGarden, data: dict, *, strict: bool, baseline: Decimal | None = None
) -> SessionOutcome:
    """Evalua una sesion sin escribir nada. Lanza ValidationError o SessionConflict.

    `baseline` es el progreso del libro ANTES de esta sesion cuando el libro guardado ya incluye
    el lote que se esta sincronizando (el cliente envia el libro con su estado final junto a sus
    sesiones, y se fusiona antes de evaluarlas). Estado, `delta`, florecimiento y Bono Solar se
    calculan contra el, igual que el cliente al cerrar la sesion. Sin `baseline` (sessions/complete)
    se usa el progreso guardado. Pagina y CFI siguen decidiendose contra el libro real.
    """
    if data["session_status"] == SessionStatus.INVALIDATED_GRACE_EXPIRED:
        # Periodo de gracia vencido: no toca progreso ni racha ni requiere datos de progreso.
        return SessionOutcome(
            status=SessionStatus.INVALIDATED_GRACE_EXPIRED,
            delta=ZERO,
            new_progress=book.progress_percentage,
            new_page=book.current_page,
            update_cfi=False,
            just_bloomed=False,
            granted_solar_bonus=False,
        )

    if strict:
        if book.status == BookGarden.Status.FALLOW:
            raise SessionConflict("El libro esta en barbecho; restauralo para leerlo.")
        if book.progress_percentage >= HUNDRED:
            raise SessionConflict("El libro ya florecio.")

    previous = book.progress_percentage if baseline is None else baseline
    new_progress, new_page, advanced = _new_progress(book, data)
    if baseline is not None:
        reported, _ = _reported_progress(book, data)
        new_progress = max(baseline, min(reported, HUNDRED))
    status = _validated_status(data, new_progress, previous)
    delta = new_progress - previous
    return SessionOutcome(
        status=status,
        delta=delta,
        new_progress=new_progress,
        new_page=new_page,
        # El CFI solo se actualiza si la lectura no retrocedio: uno atrasado no pisa uno nuevo.
        update_cfi=(
            book.format_type == BookGarden.FormatType.EPUB
            and advanced
            and bool(data.get("last_epub_cfi"))
        ),
        just_bloomed=new_progress >= HUNDRED and previous < HUNDRED,
        granted_solar_bonus=streak_engine.grants_solar_bonus(book.format_type, delta, status),
    )


def persist_session(book: BookGarden, data: dict, outcome: SessionOutcome) -> ReadingSession:
    """Aplica el resultado al libro (si la sesion es valida) y crea la sesion."""
    if outcome.is_valid:
        # El progreso del libro nunca baja: con `baseline` el resultado puede ser menor que el
        # guardado (el lote ya fusiono el estado final del libro).
        progress = max(book.progress_percentage, outcome.new_progress)
        changed = (
            book.progress_percentage != progress
            or book.current_page != outcome.new_page
            or outcome.update_cfi
            or outcome.just_bloomed
        )
        book.progress_percentage = progress
        book.current_page = outcome.new_page
        if outcome.update_cfi:
            book.last_epub_cfi = data["last_epub_cfi"]
        if outcome.just_bloomed:
            book.status = BookGarden.Status.BLOOMED
            if book.completed_at is None:  # un libro que florecio al fusionarse conserva su fecha
                book.completed_at = timezone.now()
        # Solo se guarda si algo cambio: updated_at decide los conflictos de la sync.
        if changed:
            book.save()

    excerpt = data.get("extracted_epub_excerpt")
    keep_excerpt = outcome.is_valid and book.format_type == BookGarden.FormatType.EPUB
    return ReadingSession.objects.create(
        id=data["id"],
        book=book,
        planned_duration_sec=data["planned_duration_sec"],
        actual_duration_sec=data["actual_duration_sec"],
        started_at_local=data["started_at_local"],
        session_status=outcome.status,
        progress_delta=outcome.delta,
        granted_solar_bonus=outcome.granted_solar_bonus,
        extracted_epub_excerpt=excerpt if keep_excerpt and excerpt else None,
    )


def lock_profile(profile_id) -> ReaderProfile:
    """Bloquea la fila del perfil: serializa los cierres y las sincronizaciones del lector."""
    return ReaderProfile.objects.select_for_update().get(pk=profile_id)


def find_existing_session(profile: ReaderProfile, session_id) -> ReadingSession | None:
    """Sesion ya guardada con ese UUID (reintento idempotente), o None.

    Si el UUID pertenece a otro perfil lanza SessionConflict sin revelar datos.
    """
    existing = ReadingSession.objects.select_related("book").filter(pk=session_id).first()
    if existing is None:
        return None
    if existing.book.profile_id != profile.id:
        raise SessionConflict("Identificador de sesion no disponible.", code="id_conflict")
    return existing


def apply_streak_incrementally(profile: ReaderProfile, session: ReadingSession) -> None:
    """Racha incremental de un cierre en orden cronologico (`sessions/complete`)."""
    state = streak_engine.StreakState(
        profile.current_streak, profile.longest_streak, profile.last_valid_session_date
    )
    updated = streak_engine.apply_session_if_valid(
        state, session.started_at_local, session.session_status
    )
    if updated != state:
        profile.current_streak = updated.current
        profile.longest_streak = updated.longest
        profile.last_valid_session_date = updated.last_date
        profile.save(update_fields=["current_streak", "longest_streak", "last_valid_session_date"])


def complete_session(profile_id, data: dict) -> CompletionResult:
    with transaction.atomic():
        profile = lock_profile(profile_id)

        existing = find_existing_session(profile, data["id"])
        if existing is not None:
            return CompletionResult(existing, existing.book, profile, False, False)

        book = (
            BookGarden.objects.select_for_update()
            .filter(pk=data["book_id"], profile=profile)
            .first()
        )
        if book is None:
            raise Http404

        outcome = evaluate_session(book, data, strict=True)
        session = persist_session(book, data, outcome)
        apply_streak_incrementally(profile, session)
        return CompletionResult(session, book, profile, True, outcome.just_bloomed)
