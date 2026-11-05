// Plan de habito (SRS 5.1). Replica apps/profiles/services.py (calculate_habit_plan).
//
// Cliente y servidor deben dar el mismo resultado para todas las respuestas. La prueba
// habitPlan.test.ts lo verifica contra src/shared/fixtures/habitPlanCases.json, generado desde la
// implementacion del backend. Si el algoritmo cambia, regenerar el archivo (desde komi_backend/,
// con .venv activado):
//   python manage.py dump_habit_plan_cases
// y revisar el diff. `python manage.py dump_habit_plan_cases --check` falla si esta desactualizado.

import type { AiReflectionStyle, PreferredMoment } from "../data/local_db/types";

export type AnswerAD = "A" | "B" | "C" | "D";
export type AnswerAC = "A" | "B" | "C";

export interface OnboardingAnswers {
  q1: AnswerAD;
  q2: AnswerAD;
  q3: AnswerAD;
  q4: AnswerAD;
  q5: AnswerAC;
}

const AD = ["A", "B", "C", "D"];
const AC = ["A", "B", "C"];

/** Las 5 respuestas completas y validas (q5 solo admite A a C). */
export function isCompleteAnswers(value: unknown): value is OnboardingAnswers {
  if (typeof value !== "object" || value === null) return false;
  const a = value as Record<string, unknown>;
  return (
    AD.includes(a["q1"] as string) &&
    AD.includes(a["q2"] as string) &&
    AD.includes(a["q3"] as string) &&
    AD.includes(a["q4"] as string) &&
    AC.includes(a["q5"] as string)
  );
}

export interface HabitPlan {
  daily_goal_minutes: number;
  preferred_moment: PreferredMoment;
  ai_reflection_style: AiReflectionStyle;
  preconfigure_tsukimi: boolean;
}

/** Pregunta 2: tiempo base en minutos. */
const BASE_MINUTES: Record<AnswerAD, number> = { A: 10, B: 15, C: 30, D: 45 };
/** Pregunta 3: momento del dia. */
const MOMENTS: Record<AnswerAD, PreferredMoment> = {
  A: "MORNING",
  B: "AFTERNOON",
  C: "NIGHT",
  D: "COMMUTE",
};
/** Pregunta 5: estilo de reflexion con la IA. */
const STYLES: Record<AnswerAC, AiReflectionStyle> = {
  A: "MEMORY_QUIZ",
  B: "DEEP_ANALYSIS",
  C: "KEY_SUMMARY",
};

const BEGINNER: AnswerAD = "A"; // Pregunta 1: "Estoy empezando desde cero".
const BEDTIME: AnswerAD = "C"; // Pregunta 3: "Antes de dormir".
const TIRED: AnswerAD = "B"; // Pregunta 4: "El cansancio o sueno al leer".
const HIGH_GOALS: AnswerAD = "D"; // Pregunta 4: "Empezar con metas muy altas y abandonar rapido".

export const PROTECTIVE_CAP_MINUTES = 15;
export const FATIGUE_THRESHOLD_MINUTES = 20;
export const FATIGUE_GOAL_MINUTES = 15;

/**
 * 1. T_base es el tiempo de la pregunta 2.
 * 2. Proteccion anti-abandono: con q1 = A o q4 = D, meta = min(T_base, 15).
 * 3. Fatiga nocturna: con q3 = C, q4 = B y T_base > 20, meta = 15 y se preconfigura Tsukimi.
 */
export function calculateHabitPlan(answers: OnboardingAnswers): HabitPlan {
  const { q1, q2, q3, q4, q5 } = answers;
  const tBase = BASE_MINUTES[q2];
  let goal = tBase;
  let tsukimi = false;

  if (q1 === BEGINNER || q4 === HIGH_GOALS) {
    goal = Math.min(tBase, PROTECTIVE_CAP_MINUTES);
  }

  if (q3 === BEDTIME && q4 === TIRED && tBase > FATIGUE_THRESHOLD_MINUTES) {
    goal = FATIGUE_GOAL_MINUTES;
    tsukimi = true;
  }

  return {
    daily_goal_minutes: goal,
    preferred_moment: MOMENTS[q3],
    ai_reflection_style: STYLES[q5],
    preconfigure_tsukimi: tsukimi,
  };
}
