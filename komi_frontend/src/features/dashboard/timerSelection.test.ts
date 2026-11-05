import { describe, expect, it } from "vitest";
import {
  formatTimer,
  initialMinutes,
  stepMinutes,
  TIMER_MAX_MINUTES,
  TIMER_MIN_MINUTES,
} from "./timerSelection";

describe("initialMinutes", () => {
  it("las metas del plan (10, 15, 30, 45) se conservan", () => {
    for (const goal of [10, 15, 30, 45]) expect(initialMinutes(goal)).toBe(goal);
  });

  it("redondea al multiplo de 5 mas cercano y respeta 5 a 120", () => {
    expect(initialMinutes(17)).toBe(15);
    expect(initialMinutes(18)).toBe(20);
    expect(initialMinutes(1)).toBe(TIMER_MIN_MINUTES);
    expect(initialMinutes(0)).toBe(TIMER_MIN_MINUTES);
    expect(initialMinutes(-40)).toBe(TIMER_MIN_MINUTES);
    expect(initialMinutes(500)).toBe(TIMER_MAX_MINUTES);
    expect(initialMinutes(120)).toBe(120);
    expect(initialMinutes(Number.NaN)).toBe(15);
    expect(initialMinutes(Number.POSITIVE_INFINITY)).toBe(15);
  });
});

describe("stepMinutes", () => {
  it("avanza y retrocede de 5 en 5", () => {
    expect(stepMinutes(15, "increment")).toBe(20);
    expect(stepMinutes(15, "decrement")).toBe(10);
  });

  it("no baja de 5 ni sube de 120", () => {
    expect(stepMinutes(5, "decrement")).toBe(5);
    expect(stepMinutes(10, "decrement")).toBe(5);
    expect(stepMinutes(120, "increment")).toBe(120);
    expect(stepMinutes(115, "increment")).toBe(120);
  });

  it("un valor fuera de la rejilla se normaliza antes de mover", () => {
    expect(stepMinutes(17, "increment")).toBe(20);
  });
});

describe("formatTimer", () => {
  it("usa dos digitos como minimo y :00", () => {
    expect(formatTimer(5)).toBe("05:00");
    expect(formatTimer(15)).toBe("15:00");
    expect(formatTimer(120)).toBe("120:00");
  });

  it("acota valores fuera de rango", () => {
    expect(formatTimer(0)).toBe("05:00");
    expect(formatTimer(999)).toBe("120:00");
  });
});
