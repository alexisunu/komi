"""Casos de prueba de la racha compartidos con el cliente (SRS 16 punto 2 y 19, punto 4).

El archivo JSON lo consume la prueba de Vitest del frontend para garantizar que `localStreak.ts`
calcula lo mismo que `streak_engine.py`. Se regenera con `python manage.py dump_streak_cases`.

Cada caso: sesiones `[started_at_local, session_status]`, la fecha local de "hoy", el record
previo y el resultado esperado de `recompute_from_dates` y `effective_streak`.
"""

import json
from datetime import date, datetime, timedelta
from pathlib import Path

from django.conf import settings

from apps.reading_sessions import streak_engine

FIXTURE_PATH = (
    Path(settings.BASE_DIR).parent
    / "komi_frontend"
    / "src"
    / "shared"
    / "fixtures"
    / "streakCases.json"
)

_BASE = date(2026, 3, 1)
_COMPLETED = "COMPLETED"
_EARLY = "EARLY_VALID"
_INVALID = "INVALIDATED_GRACE_EXPIRED"


def _stamp(day_offset: int, clock: str = "08:00:00") -> str:
    return f"{(_BASE + timedelta(days=day_offset)).isoformat()}T{clock}"


def _expected(sessions: list[list[str]], today: str, previous_longest: int) -> dict:
    dates = [
        datetime.fromisoformat(started).date()
        for started, status in sessions
        if streak_engine.is_valid_status(status)
    ]
    state = streak_engine.recompute_from_dates(dates, previous_longest)
    return {
        "current": state.current,
        "longest": state.longest,
        "last_date": state.last_date.isoformat() if state.last_date else None,
        "effective": streak_engine.effective_streak(state, date.fromisoformat(today)),
    }


def _case(name: str, sessions: list[list[str]], today: str, previous_longest: int = 0) -> dict:
    return {
        "name": name,
        "sessions": sessions,
        "today": today,
        "previous_longest": previous_longest,
        "expected": _expected(sessions, today, previous_longest),
    }


def _handwritten() -> list[dict]:
    return [
        _case("sin sesiones", [], _stamp(0)[:10]),
        _case("sin sesiones y con record previo", [], _stamp(0)[:10], previous_longest=7),
        _case("una sesion valida, hoy", [[_stamp(0), _COMPLETED]], _stamp(0)[:10]),
        _case("terminada antes de tiempo cuenta", [[_stamp(0), _EARLY]], _stamp(0)[:10]),
        _case("invalidada no cuenta", [[_stamp(0), _INVALID]], _stamp(0)[:10]),
        _case(
            "invalidada entre dos dias validos no rompe ni suma",
            [[_stamp(0), _COMPLETED], [_stamp(1), _INVALID], [_stamp(2), _COMPLETED]],
            _stamp(2)[:10],
        ),
        _case(
            "dos sesiones el mismo dia cuentan una vez",
            [[_stamp(0, "07:00:00"), _COMPLETED], [_stamp(0, "21:00:00"), _COMPLETED]],
            _stamp(0)[:10],
        ),
        _case(
            "lectura que cruza la medianoche cuenta en el dia de inicio",
            [[_stamp(0, "23:50:00"), _COMPLETED]],
            _stamp(0)[:10],
        ),
        _case(
            "23:59:59 y 00:00:00 son dias consecutivos",
            [[_stamp(0, "23:59:59"), _COMPLETED], [_stamp(1, "00:00:00"), _COMPLETED]],
            _stamp(1)[:10],
        ),
        _case(
            "lecturas nocturnas seguidas",
            [
                [_stamp(0, "23:50:00"), _COMPLETED],
                [_stamp(1, "23:45:00"), _COMPLETED],
                [_stamp(2, "23:55:00"), _EARLY],
            ],
            _stamp(2)[:10],
        ),
        _case(
            "hueco de un dia calendario reinicia la racha",
            [[_stamp(0), _COMPLETED], [_stamp(2), _COMPLETED]],
            _stamp(2)[:10],
        ),
        _case(
            "sesiones fuera de orden",
            [[_stamp(2), _COMPLETED], [_stamp(0), _COMPLETED], [_stamp(1), _COMPLETED]],
            _stamp(2)[:10],
        ),
        _case(
            "la racha actual es la que termina en la ultima fecha",
            [
                [_stamp(0), _COMPLETED],
                [_stamp(1), _COMPLETED],
                [_stamp(2), _COMPLETED],
                [_stamp(5), _COMPLETED],
                [_stamp(6), _COMPLETED],
            ],
            _stamp(6)[:10],
        ),
        _case(
            "el record previo no baja",
            [[_stamp(0), _COMPLETED], [_stamp(1), _COMPLETED]],
            _stamp(1)[:10],
            previous_longest=9,
        ),
        _case("efectiva: hoy es el dia siguiente", [[_stamp(0), _COMPLETED]], _stamp(1)[:10]),
        _case("efectiva: pasaron dos dias", [[_stamp(0), _COMPLETED]], _stamp(2)[:10]),
        _case(
            "efectiva: hoy anterior a la ultima fecha (reloj atrasado)",
            [[_stamp(5), _COMPLETED]],
            _stamp(3)[:10],
        ),
        _case(
            "cruce de mes y de ano",
            [
                ["2026-12-31T23:50:00", _COMPLETED],
                ["2027-01-01T00:10:00", _COMPLETED],
                ["2027-01-02T07:00:00", _COMPLETED],
            ],
            "2027-01-02",
        ),
        _case(
            "29 de febrero en ano bisiesto",
            [["2028-02-28T09:00:00", _COMPLETED], ["2028-02-29T09:00:00", _COMPLETED]],
            "2028-03-01",
        ),
    ]


def _exhaustive() -> list[dict]:
    """Todos los subconjuntos de 7 dias consecutivos, con "hoy" antes y despues de la ultima."""
    cases = []
    for mask in range(1 << 7):
        days = [i for i in range(7) if mask & (1 << i)]
        sessions = [[_stamp(i), _COMPLETED] for i in days]
        for label, today_offset in (("hoy antes", 3), ("hoy despues", 9)):
            name = f"dias {''.join(str(i) for i in days) or '-'}, {label}"
            cases.append(_case(name, sessions, _stamp(today_offset)[:10]))
    return cases


def build_cases() -> dict:
    return {
        "_generated_by": "python manage.py dump_streak_cases (no editar a mano)",
        "cases": _handwritten() + _exhaustive(),
    }


def render() -> str:
    """Texto exacto del archivo: determinista, con saltos LF y una linea final."""
    data = build_cases()
    dump = {"separators": (", ", ": "), "ensure_ascii": False}
    lines = [json.dumps(case, **dump) for case in data["cases"]]
    return (
        "{\n"
        f' "_generated_by": {json.dumps(data["_generated_by"])},\n'
        ' "cases": [\n  ' + ",\n  ".join(lines) + "\n ]\n}\n"
    )
