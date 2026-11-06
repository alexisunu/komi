"""Sincronizacion offline-first del perfil (SRS 11.4 y 17, punto 18).

Consolida lotes de libros y sesiones, y arma la hidratacion de un cliente vacio. Las reglas de
sesion viven en `apps.reading_sessions.services` y se comparten con `sessions/complete`.
"""

import uuid
from datetime import UTC, timedelta
from decimal import ROUND_DOWN, Decimal

from django.db import transaction
from django.db.models.functions import TruncDate
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.ai_companion.models import ReflectionChat
from apps.garden.models import BookGarden
from apps.garden.services import resolve_status
from apps.profiles.models import ReaderProfile
from apps.profiles.serializers import SyncBookSerializer
from apps.reading_sessions import services as session_services
from apps.reading_sessions import streak_engine
from apps.reading_sessions.models import ReadingSession
from apps.reading_sessions.serializers import SessionPayloadSerializer

# --- Sincronizacion offline-first (SRS 11.4 y 17, punto 18) ---

# Un updated_at del cliente mas adelantado que esto se rechaza (el elemento, no el lote).
MAX_UPDATED_AT_LEAD = timedelta(minutes=5)

# Codigos de rechazo. La accion del cliente de cada uno esta en el SRS (seccion 17, punto 18).
VALIDATION_ERROR = "validation_error"
FUTURE_START = "future_start"
BELOW_50_PERCENT = "below_50_percent"
BOOK_NOT_FOUND = "book_not_found"
BOOK_REJECTED = "book_rejected"
ID_CONFLICT = "id_conflict"
DUPLICATE_IN_BATCH = "duplicate_in_batch"
UPDATED_AT_IN_FUTURE = "updated_at_in_future"

_SPECIFIC_CODES = {FUTURE_START, BELOW_50_PERCENT}
_TWO_PLACES = Decimal("0.01")


def _first_code(detail) -> str:
    """Primer codigo de error especifico dentro de un detalle de DRF (o validation_error)."""
    if isinstance(detail, dict):
        children = list(detail.values())
    elif isinstance(detail, list):
        children = detail
    else:
        code = getattr(detail, "code", None)
        return code if code in _SPECIFIC_CODES else VALIDATION_ERROR
    for child in children:
        code = _first_code(child)
        if code != VALIDATION_ERROR:
            return code
    return VALIDATION_ERROR


class _Rejected(Exception):
    def __init__(self, code: str, detail):
        super().__init__(code)
        self.code, self.detail = code, detail


def _rejection(index: int, item_id, exc: _Rejected) -> dict:
    return {"index": index, "id": item_id, "code": exc.code, "detail": exc.detail}


def _item_id(item) -> str | None:
    value = item.get("id") if isinstance(item, dict) else None
    return value if isinstance(value, str) else None


# ---- Libros ----


def _incoming_progress(data: dict, format_type: str, total_pages: int | None):
    """(progreso, pagina) del registro del cliente. El fisico se recalcula con las paginas."""
    if format_type == BookGarden.FormatType.PHYSICAL:
        page = data["current_page"]
        if total_pages is None or page > total_pages:
            raise _Rejected(
                VALIDATION_ERROR, {"current_page": "Supera el total de paginas del libro."}
            )
        progress = (Decimal(page) * 100 / Decimal(total_pages)).quantize(
            _TWO_PLACES, rounding=ROUND_DOWN
        )
        return progress, page
    return Decimal(data["progress_percentage"]).quantize(_TWO_PLACES, rounding=ROUND_DOWN), 0


def _create_book(profile: ReaderProfile, data: dict) -> BookGarden:
    format_type = data["format_type"]
    physical = format_type == BookGarden.FormatType.PHYSICAL
    total_pages = data.get("total_pages") if physical else None
    if physical and total_pages is None:
        raise _Rejected(VALIDATION_ERROR, {"total_pages": "Es obligatorio para un libro fisico."})
    progress, page = _incoming_progress(data, format_type, total_pages)

    book = BookGarden(
        id=data["id"],
        profile=profile,
        title=data["title"],
        author=data["author"],
        format_type=format_type,
        sunflower_variant=data["sunflower_variant"],
        total_pages=total_pages,
        current_page=page,
        progress_percentage=progress,
        status=data["status"],
    )
    if not physical:
        book.last_epub_cfi = data.get("last_epub_cfi") or None
    if progress >= 100:
        book.status = BookGarden.Status.BLOOMED
        book.completed_at = timezone.now()
    book.save()
    return book


def _book_fingerprint(book: BookGarden) -> tuple:
    return (
        book.title,
        book.author,
        book.status,
        book.progress_percentage,
        book.current_page,
        book.last_epub_cfi,
        book.completed_at,
    )


def _merge_book(book: BookGarden, data: dict) -> bool:
    """Fusiona el registro del cliente en el libro del servidor. Devuelve si cambio algo.

    - Progreso y pagina: MAX; el progreso nunca baja.
    - Titulo, autor, estado y CFI: gana el registro con updated_at mas reciente (el del cliente
      contra el guardado en el servidor). El CFI se toma literalmente de ese registro, de modo
      que puede quedar por detras del progreso maximo (SRS 17, punto 7).
    - Un libro que llega a 100% por primera vez florece; uno ya florecido no vuelve a florecer.
    """
    before = _book_fingerprint(book)
    progress, page = _incoming_progress(data, book.format_type, book.total_pages)

    previous = book.progress_percentage
    book.progress_percentage = max(previous, progress)
    book.current_page = max(book.current_page, page)
    if book.progress_percentage >= 100 and previous < 100:
        book.status = BookGarden.Status.BLOOMED
        book.completed_at = timezone.now()

    if data["updated_at"] > book.updated_at:
        book.title, book.author = data["title"], data["author"]
        cfi = data.get("last_epub_cfi")
        if book.format_type == BookGarden.FormatType.EPUB and cfi:
            book.last_epub_cfi = cfi
        requested = data["status"]
        bloomed = book.status == BookGarden.Status.BLOOMED or book.progress_percentage >= 100
        if not (requested == BookGarden.Status.FALLOW and bloomed):
            book.status = resolve_status(book, requested)

    if before == _book_fingerprint(book):
        return False
    book.save()
    return True


def _sync_book(profile: ReaderProfile, item) -> tuple[BookGarden, str]:
    serializer = SyncBookSerializer(data=item)
    if not serializer.is_valid():
        raise _Rejected(_first_code(serializer.errors), serializer.errors)
    data = serializer.validated_data
    if data["updated_at"] > timezone.now() + MAX_UPDATED_AT_LEAD:
        raise _Rejected(
            UPDATED_AT_IN_FUTURE, {"updated_at": "La marca de tiempo esta en el futuro."}
        )

    existing = BookGarden.objects.select_for_update().filter(pk=data["id"]).first()
    if existing is None:
        return _create_book(profile, data), "created"
    if existing.profile_id != profile.id:
        raise _Rejected(ID_CONFLICT, "Identificador de libro no disponible.")
    _merge_book(existing, data)
    return existing, "merged"


# ---- Sesiones ----


def _parse_session(item) -> dict:
    serializer = SessionPayloadSerializer(data=item)
    if not serializer.is_valid():
        raise _Rejected(_first_code(serializer.errors), serializer.errors)
    return dict(serializer.validated_data)


def _canonical_uuid(value) -> str | None:
    try:
        return str(uuid.UUID(str(value)))
    except (ValueError, AttributeError, TypeError):
        return None


def _snapshot_baselines(profile: ReaderProfile, books: list, sessions: list) -> dict:
    """Progreso de cada libro del lote ANTES de fusionarlo (SRS 17, punto 18).

    El cliente envia el libro con su estado final junto a sus sesiones y los libros se fusionan
    antes de evaluar las sesiones: sin esta foto, `previous` seria el progreso final del lote y
    una sesion corta que cierra el libro se rechazaria como `below_50_percent`. Un libro que no
    existe todavia parte de 0. El valor avanza por cada sesion valida (reproduccion cronologica).
    """
    ids: set[str] = set()
    for item in books:
        ids.add(_canonical_uuid(_item_id(item)) or "")
    for item in sessions:
        book_id = item.get("book_id") if isinstance(item, dict) else None
        ids.add(_canonical_uuid(book_id) or "")
    ids.discard("")
    rows = BookGarden.objects.filter(profile=profile, pk__in=ids).values_list(
        "id", "progress_percentage"
    )
    known = {str(book_id): progress for book_id, progress in rows}
    return {book_id: known.get(book_id, session_services.ZERO) for book_id in ids}


def _sync_session(
    profile: ReaderProfile, data: dict, rejected_books: set, baselines: dict | None = None
) -> tuple:
    existing = session_services.find_existing_session(profile, data["id"])
    if existing is not None:
        return existing, "duplicate", False

    if str(data["book_id"]) in rejected_books:
        raise _Rejected(BOOK_REJECTED, "El libro de esta sesion fue rechazado en este lote.")
    book = (
        BookGarden.objects.select_for_update().filter(pk=data["book_id"], profile=profile).first()
    )
    if book is None:
        raise _Rejected(BOOK_NOT_FOUND, "El libro no existe en el servidor ni en el lote.")

    key = str(book.id)
    baseline = None if baselines is None else baselines.get(key)
    outcome = session_services.evaluate_session(book, data, strict=False, baseline=baseline)
    session = session_services.persist_session(book, data, outcome)
    if baselines is not None and outcome.is_valid:
        baselines[key] = outcome.new_progress  # la siguiente sesion del lote parte de aqui
    return session, "created", outcome.just_bloomed


def _recompute_streak(profile: ReaderProfile) -> None:
    """Racha desde todas las fechas locales validas del perfil (idempotente y sin orden)."""
    dates = (
        ReadingSession.objects.filter(
            book__profile=profile,
            session_status__in=streak_engine.VALID_STATUSES,
        )
        .annotate(local_date=TruncDate("started_at_local", tzinfo=UTC))
        .values_list("local_date", flat=True)
        .distinct()
    )
    state = streak_engine.recompute_from_dates(list(dates), previous_longest=profile.longest_streak)
    profile.current_streak = state.current
    profile.longest_streak = state.longest
    profile.last_valid_session_date = state.last_date
    profile.save(update_fields=["current_streak", "longest_streak", "last_valid_session_date"])


def _process_books(profile, books, report, touched, rejected_books) -> None:
    seen: set[str] = set()
    for index, item in enumerate(books):
        item_id = _item_id(item)
        try:
            if item_id is not None and item_id.lower() in seen:
                raise _Rejected(DUPLICATE_IN_BATCH, "Libro repetido dentro del lote.")
            with transaction.atomic():
                book, result = _sync_book(profile, item)
            seen.add(str(book.id))
            touched[str(book.id)] = book
            report["books"]["accepted"].append({"id": str(book.id), "result": result})
        except _Rejected as exc:
            if item_id is not None:
                rejected_books.add(item_id.lower())
            report["books"]["rejected"].append(_rejection(index, item_id, exc))


def _process_sessions(profile, sessions, report, touched, rejected_books, baselines) -> None:
    rejected = report["sessions"]["rejected"]
    parsed: list[tuple[int, dict]] = []
    seen: set[str] = set()
    for index, item in enumerate(sessions):
        try:
            data = _parse_session(item)
            if str(data["id"]) in seen:
                raise _Rejected(DUPLICATE_IN_BATCH, "Sesion repetida dentro del lote.")
            seen.add(str(data["id"]))
            parsed.append((index, data))
        except _Rejected as exc:
            rejected.append(_rejection(index, _item_id(item), exc))

    # Orden cronologico, sin importar el orden de llegada (sort estable).
    parsed.sort(key=lambda pair: pair[1]["started_at_local"])
    # El extracto solo se conserva en la sesion mas reciente del lote (SRS 17, punto 18).
    for _, data in parsed[:-1]:
        data["extracted_epub_excerpt"] = None

    for index, data in parsed:
        item_id = str(data["id"])
        try:
            with transaction.atomic():
                session, result, bloomed = _sync_session(profile, data, rejected_books, baselines)
        except _Rejected as exc:
            rejected.append(_rejection(index, item_id, exc))
        except session_services.SessionConflict:
            exc = _Rejected(ID_CONFLICT, "Identificador de sesion no disponible.")
            rejected.append(_rejection(index, item_id, exc))
        except ValidationError as error:
            exc = _Rejected(_first_code(error.detail), error.detail)
            rejected.append(_rejection(index, item_id, exc))
        else:
            touched.setdefault(str(session.book_id), session.book)
            report["sessions"]["accepted"].append(
                {
                    "id": item_id,
                    "result": result,
                    "session_status": session.session_status,
                    "progress_delta": float(session.progress_delta),
                    "just_bloomed": bloomed,
                }
            )
    rejected.sort(key=lambda entry: entry["index"])


def sync_batch(profile_id, books: list, sessions: list) -> dict:
    """Consolida un lote offline-first en una transaccion (SRS 11.4).

    Los libros se procesan antes que las sesiones; las sesiones, en orden cronologico sin
    importar el orden de llegada. Cada elemento corre en su propio savepoint: uno invalido se
    rechaza (con codigo y motivo) sin tumbar el lote.
    """
    report = {
        "books": {"accepted": [], "rejected": []},
        "sessions": {"accepted": [], "rejected": []},
    }
    touched: dict[str, BookGarden] = {}
    rejected_books: set[str] = set()

    with transaction.atomic():
        profile = session_services.lock_profile(profile_id)
        baselines = _snapshot_baselines(profile, books, sessions)
        _process_books(profile, books, report, touched, rejected_books)
        _process_sessions(profile, sessions, report, touched, rejected_books, baselines)
        _recompute_streak(profile)

        fresh = BookGarden.objects.filter(pk__in=touched.keys(), profile=profile)
        report["server_books"] = list(fresh.order_by("created_at", "id"))
        report["profile"] = profile
    return report


def restore_profile(profile_id) -> dict:
    """Todo lo necesario para hidratar un cliente vacio (SRS 11.4, hidratacion automatica)."""
    profile = ReaderProfile.objects.get(pk=profile_id)
    books = BookGarden.objects.filter(profile=profile).order_by("created_at", "id")
    sessions = (
        ReadingSession.objects.filter(book__profile=profile)
        .defer("extracted_epub_excerpt")
        .order_by("started_at_local", "id")
    )
    # Solo las charlas cerradas (con su semilla y mensajes) de sesiones validas: una charla
    # abierta se retoma con companion/start/, que devuelve la existente (SRS 17, punto 20).
    chats = (
        ReflectionChat.objects.filter(
            session__book__profile=profile,
            session__session_status__in=streak_engine.VALID_STATUSES,
            is_closed=True,
        )
        .prefetch_related("messages")
        .order_by("session__started_at_local", "id")
    )
    return {
        "profile": profile,
        "books": list(books),
        "sessions": list(sessions),
        "chats": list(chats),
    }
