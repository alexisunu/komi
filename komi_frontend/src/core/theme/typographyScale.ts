// Escala tipografica mobile (SRS 9.3). Los valores se publican como variables CSS
// desde `themeCss.ts`; los componentes usan `var(--font-...)`, nunca px sueltos.

export const FONT_FAMILIES = {
  serif: "'Lora', Georgia, serif",
  sans: "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif",
} as const;

export interface TypeStyle {
  size: number;
  lineHeight: number;
  weight: number;
  family: keyof typeof FONT_FAMILIES;
}

export const TYPE_SCALE = {
  "display-timer": { size: 48, lineHeight: 56, weight: 600, family: "sans" },
  h1: { size: 24, lineHeight: 32, weight: 600, family: "serif" },
  h2: { size: 20, lineHeight: 28, weight: 500, family: "serif" },
  body: { size: 16, lineHeight: 24, weight: 400, family: "sans" },
  caption: { size: 13, lineHeight: 18, weight: 500, family: "sans" },
} as const satisfies Record<string, TypeStyle>;

export type TypeStyleName = keyof typeof TYPE_SCALE;

/** Variables CSS `--font-<estilo>-size|line|weight|family` y las familias base. */
export function typographyEntries(): Array<[string, string]> {
  const entries: Array<[string, string]> = [
    ["--font-serif", FONT_FAMILIES.serif],
    ["--font-sans", FONT_FAMILIES.sans],
  ];
  for (const [name, style] of Object.entries(TYPE_SCALE)) {
    entries.push(
      [`--font-${name}-size`, `${style.size}px`],
      [`--font-${name}-line`, `${style.lineHeight}px`],
      [`--font-${name}-weight`, String(style.weight)],
      [`--font-${name}-family`, `var(--font-${style.family})`],
    );
  }
  return entries;
}
