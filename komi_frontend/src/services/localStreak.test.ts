import { describe, expect, it } from "vitest";
import cases from "../shared/fixtures/streakCases.json";
import { computeStreak, type StreakResult } from "./localStreak";

interface FixtureCase {
  name: string;
  sessions: [string, string][];
  today: string;
  previous_longest: number;
  expected: StreakResult;
}

const fixture = cases.cases as FixtureCase[];

describe("racha local: coincidencia con streak_engine.py", () => {
  it("el archivo trae los casos escritos a mano y los 128 subconjuntos con dos fechas de hoy", () => {
    expect(fixture.length).toBeGreaterThanOrEqual(128 * 2 + 10);
    expect(new Set(fixture.map((c) => c.name)).size).toBe(fixture.length);
  });

  it("da el mismo resultado que el servidor en cada caso", () => {
    const mismatches = fixture
      .map((c) => ({
        name: c.name,
        got: computeStreak(
          c.sessions.map(([started_at_local, session_status]) => ({ started_at_local, session_status })),
          c.today,
          c.previous_longest,
        ),
        want: c.expected,
      }))
      .filter(({ got, want }) => JSON.stringify(got) !== JSON.stringify(want));
    expect(mismatches).toEqual([]);
  });
});

describe("racha local: sesiones rechazadas por el servidor", () => {
  const ok = { session_status: "COMPLETED" as const };

  it("una sesion con rechazo permanente no cuenta", () => {
    const result = computeStreak(
      [
        { ...ok, started_at_local: "2026-03-01T08:00:00" },
        { ...ok, started_at_local: "2026-03-02T08:00:00", sync_rejection: "future_start" },
      ],
      "2026-03-02",
    );
    expect(result).toMatchObject({ current: 1, last_date: "2026-03-01", effective: 1 });
  });

  it("un rechazo en el medio rompe la cadena", () => {
    const result = computeStreak(
      [
        { ...ok, started_at_local: "2026-03-01T08:00:00" },
        { ...ok, started_at_local: "2026-03-02T08:00:00", sync_rejection: "below_50_percent" },
        { ...ok, started_at_local: "2026-03-03T08:00:00" },
      ],
      "2026-03-03",
    );
    expect(result.current).toBe(1);
    expect(result.longest).toBe(1);
  });

  it("sync_rejection nulo o ausente cuenta con normalidad", () => {
    const result = computeStreak(
      [
        { ...ok, started_at_local: "2026-03-01T08:00:00", sync_rejection: null },
        { ...ok, started_at_local: "2026-03-02T08:00:00" },
      ],
      "2026-03-02",
    );
    expect(result.current).toBe(2);
  });
});

describe("racha local: entradas raras", () => {
  it("ignora fechas ilegibles sin lanzar error", () => {
    const result = computeStreak(
      [{ started_at_local: "no es fecha", session_status: "COMPLETED" }],
      "2026-03-02",
    );
    expect(result).toEqual({ current: 0, longest: 0, last_date: null, effective: 0 });
  });

  it("con la fecha de hoy ilegible conserva la racha", () => {
    const result = computeStreak([{ started_at_local: "2026-03-01T08:00:00", session_status: "COMPLETED" }], "x");
    expect(result.effective).toBe(1);
  });

  it("ignora un desfase de zona escrito en el texto (solo importa la fecha de pared)", () => {
    const result = computeStreak(
      [{ started_at_local: "2026-03-01T23:50:00-05:00", session_status: "COMPLETED" }],
      "2026-03-01",
    );
    expect(result.last_date).toBe("2026-03-01");
  });
});
