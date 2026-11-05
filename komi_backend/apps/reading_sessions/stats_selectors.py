"""Agregaciones de estadisticas semanales (SRS 11.3, CU-06 y 17, puntos 12 y 19).

La semana es ISO (lunes a domingo) y se mide con `started_at_local` SIN convertir: es la hora
de pared local etiquetada como UTC (ver ReadingSession.started_at_local). Por eso aqui todo se
hace con fechas y limites etiquetados como UTC y nunca con la zona horaria del servidor. Solo
cuentan las sesiones validas (COMPLETED y EARLY_VALID).
"""

import re
from datetime import UTC, date, datetime, time, timedelta

from django.db.models import Count, Sum
from django.db.models.functions import TruncDate

from apps.ai_companion.models import ReflectionChat
from apps.garden.models import BookGarden
from apps.reading_sessions.models import ReadingSession
from apps.reading_sessions.streak_engine import VALID_STATUSES

MIN_YEAR, MAX_YEAR = 2000, 2100
_WEEK_RE = re.compile(r"^(\d{4})-W(\d{2})$")
_DATE_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")


class InvalidWeek(ValueError):
    """El parametro `week` no es una semana ISO valida."""


class InvalidDate(ValueError):
    """El parametro `today` no es una fecha valida."""


def monday_of_week(text: str) -> date:
    """Lunes de una semana ISO escrita como `2026-W45`."""
    match = _WEEK_RE.match(text)
    if not match:
        raise InvalidWeek("Usa el formato AAAA-Wss, por ejemplo 2026-W45.")
    year, week = int(match.group(1)), int(match.group(2))
    if not MIN_YEAR <= year <= MAX_YEAR:
        raise InvalidWeek(f"El ano debe estar entre {MIN_YEAR} y {MAX_YEAR}.")
    try:
        return date.fromisocalendar(year, week, 1)
    except ValueError:
        raise InvalidWeek("Esa semana no existe en el calendario ISO.") from None


def monday_of_date(text: str) -> date:
    """Lunes de la semana ISO que contiene la fecha `AAAA-MM-DD`."""
    match = _DATE_RE.match(text)
    if not match:
        raise InvalidDate("Usa el formato AAAA-MM-DD.")
    try:
        day = date(int(match.group(1)), int(match.group(2)), int(match.group(3)))
    except ValueError:
        raise InvalidDate("Fecha inexistente.") from None
    if not MIN_YEAR <= day.year <= MAX_YEAR:
        raise InvalidDate(f"El ano debe estar entre {MIN_YEAR} y {MAX_YEAR}.")
    return day - timedelta(days=day.weekday())


def week_label(monday: date) -> str:
    iso = monday.isocalendar()
    return f"{iso.year}-W{iso.week:02d}"


def weekly_stats(profile, monday: date) -> dict:
    start = datetime.combine(monday, time.min, tzinfo=UTC)
    end = start + timedelta(days=7)

    sessions = ReadingSession.objects.filter(
        book__profile=profile,
        session_status__in=VALID_STATUSES,
        started_at_local__gte=start,
        started_at_local__lt=end,
    )
    per_day = {
        row["day"]: row
        for row in sessions.annotate(day=TruncDate("started_at_local", tzinfo=UTC))
        .values("day")
        .annotate(seconds=Sum("actual_duration_sec"), count=Count("id"))
    }

    days = []
    for offset in range(7):
        current = monday + timedelta(days=offset)
        row = per_day.get(current)
        seconds = row["seconds"] if row else 0
        days.append(
            {
                "date": current.isoformat(),
                "seconds": seconds,
                "minutes": round(seconds / 60, 2),
                "sessions": row["count"] if row else 0,
            }
        )

    total_seconds = sum(day["seconds"] for day in days)
    closed_chats = ReflectionChat.objects.filter(is_closed=True)
    return {
        "week": week_label(monday),
        "start_date": monday.isoformat(),
        "end_date": (monday + timedelta(days=6)).isoformat(),
        "days": days,
        "total_seconds": total_seconds,
        "total_minutes": round(total_seconds / 60, 2),
        "sessions_count": sum(day["sessions"] for day in days),
        "completed_chats_week": closed_chats.filter(session__in=sessions).count(),
        "completed_chats_total": closed_chats.filter(
            session__book__profile=profile, session__session_status__in=VALID_STATUSES
        ).count(),
        "bloomed_books_total": BookGarden.objects.filter(
            profile=profile, progress_percentage__gte=100
        ).count(),
    }
