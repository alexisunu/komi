import { describe, expect, it } from "vitest";
import cases from "../shared/fixtures/habitPlanCases.json";
import { calculateHabitPlan, type OnboardingAnswers } from "./habitPlan";

interface FixtureCase {
  answers: OnboardingAnswers;
  expected: ReturnType<typeof calculateHabitPlan>;
}

const fixture = cases.cases as FixtureCase[];

describe("plan de habito: coincidencia con el servidor", () => {
  it("el archivo cubre todas las combinaciones (4*4*4*4*3)", () => {
    expect(fixture).toHaveLength(768);
    const keys = new Set(fixture.map((c) => Object.values(c.answers).join("")));
    expect(keys.size).toBe(768);
  });

  it("da el mismo resultado que calculate_habit_plan en cada combinacion", () => {
    const mismatches = fixture.filter(
      (c) => JSON.stringify(calculateHabitPlan(c.answers)) !== JSON.stringify(c.expected),
    );
    expect(mismatches.map((c) => Object.values(c.answers).join(""))).toEqual([]);
  });
});

const base: OnboardingAnswers = { q1: "B", q2: "B", q3: "A", q4: "A", q5: "B" };
const plan = (o: Partial<OnboardingAnswers>) => calculateHabitPlan({ ...base, ...o });

describe("plan de habito: bordes de SRS 5.1", () => {
  it("tiempo base sin protecciones", () => {
    expect([10, 15, 30, 45]).toEqual(
      (["A", "B", "C", "D"] as const).map((q2) => plan({ q2 }).daily_goal_minutes),
    );
  });

  it("principiante o metas altas topa en 15 y no sube los 10", () => {
    expect(plan({ q1: "A", q2: "A" }).daily_goal_minutes).toBe(10);
    expect(plan({ q1: "A", q2: "B" }).daily_goal_minutes).toBe(15);
    expect(plan({ q1: "A", q2: "D" }).daily_goal_minutes).toBe(15);
    expect(plan({ q4: "D", q2: "C" }).daily_goal_minutes).toBe(15);
  });

  it("fatiga nocturna: exige q3=C, q4=B y T_base > 20", () => {
    const fatigued = plan({ q3: "C", q4: "B", q2: "C" });
    expect(fatigued.daily_goal_minutes).toBe(15);
    expect(fatigued.preconfigure_tsukimi).toBe(true);
    // T_base 15 (no mayor que 20): no se activa.
    expect(plan({ q3: "C", q4: "B", q2: "B" }).preconfigure_tsukimi).toBe(false);
    expect(plan({ q3: "C", q4: "A", q2: "C" }).preconfigure_tsukimi).toBe(false);
    expect(plan({ q3: "A", q4: "B", q2: "C" }).preconfigure_tsukimi).toBe(false);
    expect(plan({ q3: "C", q4: "B", q2: "C" }).daily_goal_minutes).toBe(15);
  });

  it("las reglas se combinan sin conflicto", () => {
    const result = plan({ q1: "A", q3: "C", q4: "B", q2: "D" });
    expect(result.daily_goal_minutes).toBe(15);
    expect(result.preconfigure_tsukimi).toBe(true);
  });

  it("mapea momento y estilo", () => {
    expect(plan({ q3: "D" }).preferred_moment).toBe("COMMUTE");
    expect(plan({ q5: "C" }).ai_reflection_style).toBe("KEY_SUMMARY");
  });
});
