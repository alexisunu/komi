"""Motor de rachas (SRS RF-06, CU-04, FA-4.1 y "Decisiones de Sprint 1").

Modulo puro: no consulta la base de datos ni modifica modelos. Trabaja con fechas de
calendario LOCALES del lector. El servidor no confia en el cliente para el calculo de
rachas: la fuente es `started_at_local` de cada sesion registrada.

Convencion de `started_at_local`: es la hora de pared local del dispositivo, sin zona real
(se almacena etiquetada como UTC). Por eso aqui NUNCA se llama a `astimezone()`: solo se
lee `.date()`. Asi una lectura iniciada a las 23:50 cuenta para ese dia aunque termine
despues de la medianoche.
"""

from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal

from apps.garden.models import BookGarden
from apps.reading_sessions.models import ReadingSession

VALID_STATUSES = frozenset(
    {
        ReadingSession.SessionStatus.COMPLETED,
        ReadingSession.SessionStatus.EARLY_VALID,
    }
)
_SOLAR_BONUS_LIMIT = Decimal("1")


@dataclass(frozen=True)
class StreakState:
    """Estado de racha de un perfil (espejo de ReaderProfile)."""

    current: int
    longest: int
    last_date: date | None


def session_local_date(started_at_local: datetime) -> date:
    """Fecha calendario local de una sesion, leida de la hora de pared sin convertir."""
    return started_at_local.date()


def is_valid_status(status: str) -> bool:
    """Solo COMPLETED y EARLY_VALID cuentan para la racha."""
    return status in VALID_STATUSES


def apply_session(state: StreakState, session_date: date) -> StreakState:
    """Incorpora una sesion valida a la racha, asumiendo orden cronologico.

    - Misma fecha que la ultima: sin cambio.
    - Dia siguiente: la racha suma 1.
    - Hueco de mas de 1 dia: la racha vuelve a 1.
    - Fecha anterior a la ultima (sesion atrasada): sin cambio. Para consolidar lotes
      fuera de orden se usa `recompute_from_dates`.
    """
    if state.last_date is None:
        return StreakState(current=1, longest=max(state.longest, 1), last_date=session_date)

    gap = (session_date - state.last_date).days
    if gap <= 0:
        return state

    current = state.current + 1 if gap == 1 else 1
    return StreakState(current=current, longest=max(state.longest, current), last_date=session_date)


def apply_session_if_valid(
    state: StreakState, started_at_local: datetime, status: str
) -> StreakState:
    """Como `apply_session`, pero ignora las sesiones que no son validas."""
    if not is_valid_status(status):
        return state
    return apply_session(state, session_local_date(started_at_local))


def recompute_from_dates(dates: list[date], previous_longest: int = 0) -> StreakState:
    """Recalcula la racha desde un conjunto de fechas validas (idempotente).

    Tolera duplicados y desorden. `current` es la racha que termina en la ultima fecha.
    `longest` nunca baja de `previous_longest`, para que una sincronizacion no reduzca
    un record historico.
    """
    unique_dates = sorted(set(dates))
    if not unique_dates:
        return StreakState(current=0, longest=previous_longest, last_date=None)

    longest_run = 1
    run = 1
    for previous, day in zip(unique_dates, unique_dates[1:], strict=False):
        run = run + 1 if (day - previous).days == 1 else 1
        longest_run = max(longest_run, run)

    return StreakState(
        current=run,
        longest=max(previous_longest, longest_run),
        last_date=unique_dates[-1],
    )


def effective_streak(state: StreakState, today_local: date) -> int:
    """Racha a mostrar hoy: 0 si pasaron mas de 1 dia calendario sin leer.

    Si `today_local` es anterior a `last_date` (reloj del cliente atrasado o cambio de
    zona) se considera la racha intacta.
    """
    if state.last_date is None:
        return 0
    if (today_local - state.last_date).days > 1:
        return 0
    return state.current


def grants_solar_bonus(format_type: str, progress_delta: Decimal, status: str) -> bool:
    """Bono de Vitalidad Solar (FA-4.1): libro fisico, sesion valida y avance en [0, 1)."""
    return (
        format_type == BookGarden.FormatType.PHYSICAL
        and is_valid_status(status)
        and Decimal("0") <= progress_delta < _SOLAR_BONUS_LIMIT
    )
