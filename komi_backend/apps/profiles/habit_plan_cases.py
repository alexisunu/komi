"""Casos de prueba del plan de habito compartidos con el cliente (SRS 5.1 y 18, punto 11).

El archivo JSON lo consume la prueba de Vitest del frontend para garantizar que el calculo local
coincide con el del servidor. Se regenera con `python manage.py dump_habit_plan_cases`.
"""

import json
from itertools import product
from pathlib import Path

from django.conf import settings

from apps.profiles.services import calculate_habit_plan

FIXTURE_PATH = (
    Path(settings.BASE_DIR).parent
    / "komi_frontend"
    / "src"
    / "shared"
    / "fixtures"
    / "habitPlanCases.json"
)

# Todas las combinaciones validas de respuestas (q5 solo admite A a C).
_COMBINATIONS = product("ABCD", "ABCD", "ABCD", "ABCD", "ABC")


def build_cases() -> dict:
    cases = []
    for q1, q2, q3, q4, q5 in _COMBINATIONS:
        plan = calculate_habit_plan(q1, q2, q3, q4, q5)
        cases.append(
            {
                "answers": {"q1": q1, "q2": q2, "q3": q3, "q4": q4, "q5": q5},
                "expected": {
                    "daily_goal_minutes": plan.daily_goal_minutes,
                    "preferred_moment": plan.preferred_moment,
                    "ai_reflection_style": plan.ai_reflection_style,
                    "preconfigure_tsukimi": plan.preconfigure_tsukimi,
                },
            }
        )
    return {
        "_generated_by": "python manage.py dump_habit_plan_cases (no editar a mano)",
        "cases": cases,
    }


def render() -> str:
    """Texto exacto del archivo: determinista, con saltos LF y una linea final."""
    data = build_cases()
    # Un caso por linea: el archivo es legible y un cambio del algoritmo da un diff corto.
    lines = [json.dumps(case, separators=(", ", ": ")) for case in data["cases"]]
    return (
        "{\n"
        f' "_generated_by": {json.dumps(data["_generated_by"])},\n'
        ' "cases": [\n  ' + ",\n  ".join(lines) + "\n ]\n}\n"
    )
