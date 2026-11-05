// Unica fuente de los colores de Komi (SRS 9.2 y 9.5). Ningun otro archivo de src puede
// contener hex sueltos: lo verifica la prueba `noLooseColors.test.ts`.
// Prohibido #000000 y #FFFFFF puros (CLAUDE.md 5).

export type ThemeId = "light" | "dark";

/** Tokens oficiales del Brand Sheet. Nombres en kebab-case = nombres de las variables CSS. */
export interface BrandTokens {
  "bg-primary": string;
  "bg-surface": string;
  "bg-elevated": string;
  "accent-primary": string;
  "accent-secondary": string;
  "text-primary": string;
  "text-secondary": string;
  "border-subtle": string;
  "state-warning": string;
}

/**
 * Tokens DERIVADOS (SRS 18, punto 3): no forman parte de 9.2 ni de 9.5. Provienen del
 * prototipo y de los valores de 10.1 y 10.2. No se pueden usar para sustituir un token oficial.
 */
export interface DerivedTokens {
  "bg-halo": string;
  "accent-pressed": string;
  "petal-inner": string;
  "dormant-petal-outer": string;
  "dormant-petal-inner": string;
}

export interface ThemeTokens {
  brand: BrandTokens;
  derived: DerivedTokens;
}

export const KOMOREBI: ThemeTokens = {
  brand: {
    "bg-primary": "#F7F5F0",
    "bg-surface": "#EAE6DF",
    "bg-elevated": "#FDFCFA",
    "accent-primary": "#E5A93C",
    "accent-secondary": "#6B8E78",
    "text-primary": "#2C302E",
    "text-secondary": "#7A7267",
    "border-subtle": "#DCD6CC",
    "state-warning": "#C86D51",
  },
  derived: {
    "bg-halo": "#FAF8F5", // SRS 10.2
    "accent-pressed": "#D1962F", // SRS 10.1
    "petal-inner": "#F2C46D",
    "dormant-petal-outer": "#9E988E",
    "dormant-petal-inner": "#B5AFA4",
  },
};

export const TSUKIMI: ThemeTokens = {
  brand: {
    "bg-primary": "#181A18",
    "bg-surface": "#232623",
    "bg-elevated": "#2C302C",
    "accent-primary": "#EBB85B",
    "accent-secondary": "#82A890",
    "text-primary": "#ECE8DF",
    "text-secondary": "#A09A8E",
    "border-subtle": "#363A36",
    "state-warning": "#D97F64",
  },
  derived: {
    "bg-halo": "#1E211E",
    "accent-pressed": "#D4A146",
    "petal-inner": "#F2C46D",
    "dormant-petal-outer": "#9E988E",
    "dormant-petal-inner": "#B5AFA4",
  },
};

export const THEMES: Record<ThemeId, ThemeTokens> = { light: KOMOREBI, dark: TSUKIMI };

/** Pares [nombre de variable CSS, valor] de un tema. Los derivados llevan el prefijo `derived-`. */
export function themeEntries(theme: ThemeTokens): Array<[string, string]> {
  return [
    ...Object.entries(theme.brand).map(([name, value]): [string, string] => [
      `--color-${name}`,
      value,
    ]),
    ...Object.entries(theme.derived).map(([name, value]): [string, string] => [
      `--color-derived-${name}`,
      value,
    ]),
  ];
}
