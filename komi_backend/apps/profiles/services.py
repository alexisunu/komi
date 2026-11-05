"""Logica de negocio de perfiles: algoritmo del plan de habito (SRS 5.1)."""

from dataclasses import dataclass

# Pregunta 2: tiempo base en minutos.
BASE_MINUTES = {"A": 10, "B": 15, "C": 30, "D": 45}
# Pregunta 3: momento del dia.
MOMENTS = {"A": "MORNING", "B": "AFTERNOON", "C": "NIGHT", "D": "COMMUTE"}
# Pregunta 5: estilo de reflexion con la IA.
STYLES = {"A": "MEMORY_QUIZ", "B": "DEEP_ANALYSIS", "C": "KEY_SUMMARY"}

BEGINNER = "A"  # Pregunta 1: "Estoy empezando desde cero".
BEDTIME = "C"  # Pregunta 3: "Antes de dormir".
TIRED = "B"  # Pregunta 4: "El cansancio o sueno al leer".
HIGH_GOALS = "D"  # Pregunta 4: "Empezar con metas muy altas y abandonar rapido".

PROTECTIVE_CAP_MINUTES = 15
FATIGUE_THRESHOLD_MINUTES = 20
FATIGUE_GOAL_MINUTES = 15


@dataclass(frozen=True)
class HabitPlan:
    daily_goal_minutes: int
    preferred_moment: str
    ai_reflection_style: str
    preconfigure_tsukimi: bool


def calculate_habit_plan(q1: str, q2: str, q3: str, q4: str, q5: str) -> HabitPlan:
    """Calcula la meta diaria y la configuracion del perfil (SRS 5.1).

    1. T_base es el tiempo de la pregunta 2.
    2. Proteccion anti-abandono: con q1 = A o q4 = D, meta = min(T_base, 15).
    3. Fatiga nocturna: con q3 = C, q4 = B y T_base > 20, meta = 15 y se preconfigura Tsukimi.
    """
    t_base = BASE_MINUTES[q2]
    goal = t_base
    tsukimi = False

    if q1 == BEGINNER or q4 == HIGH_GOALS:
        goal = min(t_base, PROTECTIVE_CAP_MINUTES)

    if q3 == BEDTIME and q4 == TIRED and t_base > FATIGUE_THRESHOLD_MINUTES:
        goal = FATIGUE_GOAL_MINUTES
        tsukimi = True

    return HabitPlan(
        daily_goal_minutes=goal,
        preferred_moment=MOMENTS[q3],
        ai_reflection_style=STYLES[q5],
        preconfigure_tsukimi=tsukimi,
    )
