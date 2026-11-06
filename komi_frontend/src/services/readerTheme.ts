// Estilo del lector EPUB (CU-03, paso 4). El libro vive en un iframe aparte que NO hereda las
// variables CSS de la app, asi que aqui se genera el CSS con los valores de `colorTokens.ts` (la
// unica fuente de color) y se reaplica cada vez que cambia el tema o el tamano de letra.

import { THEMES, type BrandTokens, type ThemeId } from "../core/theme/colorTokens";

/** SRS CU-03: controles de tamano de 16 a 22 px. Pasos de 2 px (decision del bloque 5). */
export const FONT_SIZES = [16, 18, 20, 22] as const;
export type ReaderFontSize = (typeof FONT_SIZES)[number];
export const DEFAULT_FONT_SIZE: ReaderFontSize = 18;
export const READER_LINE_HEIGHT = 1.6;
/** Margen lateral del texto, en px. Lo pone el contenedor del lector, fuera del iframe. */
export const READER_MARGIN_PX = 24;

export function isFontSize(value: unknown): value is ReaderFontSize {
  return FONT_SIZES.includes(value as ReaderFontSize);
}

/** Siguiente tamano en la direccion pedida; se detiene en los extremos. */
export function stepFontSize(current: ReaderFontSize, direction: "smaller" | "larger"): ReaderFontSize {
  const index = FONT_SIZES.indexOf(current);
  const next = FONT_SIZES[direction === "larger" ? Math.min(index + 1, FONT_SIZES.length - 1) : Math.max(index - 1, 0)];
  return next ?? current;
}

export interface ReaderThemeInput {
  theme: ThemeId;
  fontPx: ReaderFontSize;
  /** Origen de las fuentes (por ejemplo `https://app/`). El iframe no resuelve rutas de la app. */
  fontBaseUrl: string;
}

function fontFaces(base: string): string {
  const root = base.endsWith("/") ? base : `${base}/`;
  return [
    `@font-face{font-family:"Lora";font-style:normal;font-weight:400 700;font-display:swap;src:url("${root}fonts/Lora/Lora-Variable.woff2") format("woff2");}`,
    `@font-face{font-family:"Lora";font-style:italic;font-weight:400 700;font-display:swap;src:url("${root}fonts/Lora/Lora-Italic-Variable.woff2") format("woff2");}`,
  ].join("\n");
}

/**
 * CSS inyectado en cada pagina del libro. Funcion pura. Los colores salen del tema pedido; la
 * tipografia es Lora a 1,6 de interlineado. `!important` porque el libro trae sus propios estilos.
 */
export function buildReaderCss(input: ReaderThemeInput): string {
  const tokens: BrandTokens = THEMES[input.theme].brand;
  const important = " !important";
  return [
    fontFaces(input.fontBaseUrl),
    `html{background-color:${tokens["bg-primary"]}${important};}`,
    [
      "body{",
      `background-color:${tokens["bg-primary"]}${important};`,
      `color:${tokens["text-primary"]}${important};`,
      `font-family:"Lora",Georgia,serif${important};`,
      `font-size:${input.fontPx}px${important};`,
      `line-height:${READER_LINE_HEIGHT}${important};`,
      "text-align:left;",
      "-webkit-text-size-adjust:100%;",
      "}",
    ].join(""),
    `p,li,blockquote,div,span{line-height:${READER_LINE_HEIGHT}${important};}`,
    `h1,h2,h3,h4,h5,h6{color:${tokens["text-primary"]}${important};font-family:"Lora",Georgia,serif${important};}`,
    `a,a:link,a:visited{color:${tokens["accent-secondary"]}${important};}`,
    `::selection{background-color:${tokens["accent-primary"]};color:${tokens["bg-primary"]};}`,
    `img,svg,video{max-width:100%${important};height:auto${important};}`,
    `hr{border-color:${tokens["border-subtle"]}${important};}`,
  ].join("\n");
}
