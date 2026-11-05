import { describe, expect, it } from "vitest";
import { evaluateGrowth, stageForProgress, stageNumber } from "./botanicCalculator";

describe("stageForProgress", () => {
  it.each([
    [0, "SEED_1"],
    [24, "SEED_1"],
    [24.99, "SEED_1"],
    [25, "STEM_2"],
    [59.99, "STEM_2"],
    [60, "BUD_3"],
    [99.99, "BUD_3"],
    [100, "BLOOM_4"],
  ] as const)("%s -> %s", (progress, stage) => {
    expect(stageForProgress(progress)).toBe(stage);
  });

  it("trunca a 2 decimales como el servidor, sin redondear hacia arriba", () => {
    expect(stageForProgress(24.999)).toBe("SEED_1");
    expect(stageForProgress(59.9999)).toBe("STEM_2");
    expect(stageForProgress(99.999)).toBe("BUD_3");
    expect(stageForProgress(99.9999999)).toBe("BUD_3");
  });

  it("no cae por ruido de coma flotante", () => {
    expect(stageForProgress(0.29 * 100)).toBe("STEM_2"); // 28.999999999999996 -> 28.99
    expect(stageForProgress(25.0)).toBe("STEM_2");
    expect(stageForProgress(0.1 + 0.2 + 59.7)).toBe("BUD_3"); // 60.00000000000001
  });

  it("acota valores fuera de rango y no finitos", () => {
    expect(stageForProgress(-5)).toBe("SEED_1");
    expect(stageForProgress(140)).toBe("BLOOM_4");
    expect(stageForProgress(Number.NaN)).toBe("SEED_1");
    expect(stageForProgress(Number.POSITIVE_INFINITY)).toBe("SEED_1");
  });

  it("numera las etapas de 1 a 4", () => {
    expect(
      (["SEED_1", "STEM_2", "BUD_3", "BLOOM_4"] as const).map(stageNumber),
    ).toEqual([1, 2, 3, 4]);
  });
});

describe("evaluateGrowth", () => {
  const base = { format: "PHYSICAL", previousProgress: 10, newProgress: 10.5, valid: true } as const;

  it("otorga el bono solar en fisico con avance menor a 1 punto (incluido 0)", () => {
    expect(evaluateGrowth(base).grantedSolarBonus).toBe(true);
    expect(evaluateGrowth({ ...base, newProgress: 10 }).grantedSolarBonus).toBe(true);
    expect(evaluateGrowth({ ...base, newProgress: 10.99 }).grantedSolarBonus).toBe(true);
  });

  it("no lo otorga con avance de 1 punto o mas, en EPUB ni en sesion invalida", () => {
    expect(evaluateGrowth({ ...base, newProgress: 11 }).grantedSolarBonus).toBe(false);
    expect(evaluateGrowth({ ...base, format: "EPUB" }).grantedSolarBonus).toBe(false);
    expect(evaluateGrowth({ ...base, valid: false }).grantedSolarBonus).toBe(false);
  });

  it("el progreso es monotonico: una lectura menor no baja la etapa ni el avance", () => {
    const result = evaluateGrowth({ ...base, previousProgress: 30, newProgress: 20 });
    expect(result.progress).toBe(30);
    expect(result.delta).toBe(0);
    expect(result.stage).toBe("STEM_2");
  });

  it("detecta el paso a flor una sola vez", () => {
    expect(evaluateGrowth({ ...base, previousProgress: 99.5, newProgress: 100 }).justBloomed).toBe(
      true,
    );
    expect(evaluateGrowth({ ...base, previousProgress: 99.5, newProgress: 99.99 }).justBloomed).toBe(
      false,
    );
  });

  it("un libro ya florecido no vuelve a florecer", () => {
    const again = evaluateGrowth({ ...base, previousProgress: 100, newProgress: 100 });
    expect(again.justBloomed).toBe(false);
    expect(again.stage).toBe("BLOOM_4");
  });

  it("calcula el avance con 2 decimales exactos", () => {
    expect(evaluateGrowth({ ...base, previousProgress: 24.99, newProgress: 25 }).delta).toBe(0.01);
    expect(evaluateGrowth({ ...base, previousProgress: 24.99, newProgress: 25 }).stage).toBe(
      "STEM_2",
    );
  });
});
