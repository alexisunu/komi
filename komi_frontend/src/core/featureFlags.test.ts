import { describe, expect, it } from "vitest";
import { FEATURES } from "./featureFlags";

describe("featureFlags", () => {
  it("en la v2 la racha y Estadisticas estan ocultas (bandera apagada)", () => {
    expect(FEATURES.statsAndStreak).toBe(false);
  });
});
