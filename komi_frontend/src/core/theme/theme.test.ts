import { describe, expect, it } from "vitest";
import { KOMOREBI, THEMES, TSUKIMI, themeEntries } from "./colorTokens";
import { GEOMETRY } from "./geometryTokens";
import { resolveTheme } from "./resolveTheme";
import { buildThemeCss } from "./themeCss";
import { TYPE_SCALE, typographyEntries } from "./typographyScale";

// Valores copiados de SRS 9.2 y 9.5.
const SRS_LIGHT = {
  "bg-primary": "#F7F5F0",
  "bg-surface": "#EAE6DF",
  "bg-elevated": "#FDFCFA",
  "accent-primary": "#E5A93C",
  "accent-secondary": "#6B8E78",
  "text-primary": "#2C302E",
  "text-secondary": "#7A7267",
  "border-subtle": "#DCD6CC",
  "state-warning": "#C86D51",
};
const SRS_DARK = {
  "bg-primary": "#181A18",
  "bg-surface": "#232623",
  "bg-elevated": "#2C302C",
  "accent-primary": "#EBB85B",
  "accent-secondary": "#82A890",
  "text-primary": "#ECE8DF",
  "text-secondary": "#A09A8E",
  "border-subtle": "#363A36",
  "state-warning": "#D97F64",
};

describe("colorTokens", () => {
  it("los tokens oficiales coinciden con el Brand Sheet (9.2 y 9.5)", () => {
    expect(KOMOREBI.brand).toEqual(SRS_LIGHT);
    expect(TSUKIMI.brand).toEqual(SRS_DARK);
  });

  it("ambos temas definen exactamente los mismos tokens", () => {
    expect(Object.keys(KOMOREBI.brand)).toEqual(Object.keys(TSUKIMI.brand));
    expect(Object.keys(KOMOREBI.derived)).toEqual(Object.keys(TSUKIMI.derived));
  });

  it("todos los valores son hex de 6 digitos y ninguno es negro ni blanco puro", () => {
    for (const theme of Object.values(THEMES)) {
      for (const [, value] of themeEntries(theme)) {
        expect(value).toMatch(/^#[0-9A-F]{6}$/);
        expect(value).not.toBe("#000000");
        expect(value).not.toBe("#FFFFFF");
      }
    }
  });

  it("los derivados van con prefijo propio para distinguirlos de los oficiales", () => {
    const names = themeEntries(KOMOREBI).map(([name]) => name);
    expect(names).toContain("--color-bg-primary");
    expect(names).toContain("--color-derived-bg-halo");
    expect(names.filter((n) => n.startsWith("--color-derived-"))).toHaveLength(5);
  });
});

describe("typographyScale", () => {
  it("respeta la escala del SRS 9.3", () => {
    expect(TYPE_SCALE["display-timer"]).toMatchObject({ size: 48, lineHeight: 56, weight: 600 });
    expect(TYPE_SCALE.h1).toMatchObject({ size: 24, lineHeight: 32, weight: 600, family: "serif" });
    expect(TYPE_SCALE.h2).toMatchObject({ size: 20, lineHeight: 28, weight: 500, family: "serif" });
    expect(TYPE_SCALE.body).toMatchObject({ size: 16, lineHeight: 24, weight: 400 });
    expect(TYPE_SCALE.caption).toMatchObject({ size: 13, lineHeight: 18, weight: 500 });
  });

  it("publica las variables CSS de cada estilo", () => {
    const entries = Object.fromEntries(typographyEntries());
    expect(entries["--font-display-timer-size"]).toBe("48px");
    expect(entries["--font-h1-family"]).toBe("var(--font-serif)");
  });
});

describe("geometryTokens", () => {
  it("usa multiplos de 8 px, margen de 24 px y radios del SRS 9.4", () => {
    expect(GEOMETRY["screen-margin"]).toBe("24px");
    expect(GEOMETRY["radius-pill"]).toBe("999px");
    expect(GEOMETRY["radius-card"]).toBe("20px");
    expect(GEOMETRY["radius-input"]).toBe("12px");
    expect(GEOMETRY["nav-height"]).toBe("64px");
  });

  it("las transiciones duran entre 300 y 400 ms con ease-out", () => {
    for (const key of ["transition-theme", "transition-ui"] as const) {
      const match = /^(\d+)ms ease-out$/.exec(GEOMETRY[key]);
      expect(match).not.toBeNull();
      const ms = Number(match?.[1]);
      expect(ms).toBeGreaterThanOrEqual(300);
      expect(ms).toBeLessThanOrEqual(400);
    }
  });
});

describe("buildThemeCss", () => {
  const css = buildThemeCss();

  it("define Komorebi en :root y Tsukimi bajo prefers-color-scheme y data-theme", () => {
    expect(css).toContain(":root {");
    expect(css).toContain("@media (prefers-color-scheme: dark)");
    expect(css).toContain(':root:not([data-theme="light"])');
    expect(css).toContain(':root[data-theme="dark"]');
    expect(css).toContain(":root {\n  --color-bg-primary: #F7F5F0;");
    expect(css).toContain("--color-bg-primary: #181A18;");
  });

  it("incluye tipografia y geometria", () => {
    expect(css).toContain("--font-body-size: 16px;");
    expect(css).toContain("--radius-card: 20px;");
  });
});

describe("resolveTheme", () => {
  it("la eleccion manual manda sobre todo lo demas", () => {
    expect(
      resolveTheme({ storedMode: "light", preconfigureTsukimi: true, systemPrefersDark: true }),
    ).toBe("light");
    expect(
      resolveTheme({ storedMode: "dark", preconfigureTsukimi: false, systemPrefersDark: false }),
    ).toBe("dark");
  });

  it("sin eleccion manual, el onboarding precondiciona Tsukimi", () => {
    expect(
      resolveTheme({ storedMode: null, preconfigureTsukimi: true, systemPrefersDark: false }),
    ).toBe("dark");
  });

  it("sin nada de lo anterior, sigue al sistema", () => {
    expect(
      resolveTheme({ storedMode: null, preconfigureTsukimi: null, systemPrefersDark: true }),
    ).toBe("dark");
    expect(
      resolveTheme({ storedMode: null, preconfigureTsukimi: false, systemPrefersDark: false }),
    ).toBe("light");
  });
});
