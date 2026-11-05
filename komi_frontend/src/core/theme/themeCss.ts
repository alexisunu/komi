import { THEMES, themeEntries } from "./colorTokens.ts";
import { geometryEntries } from "./geometryTokens.ts";
import { typographyEntries } from "./typographyScale.ts";

export const THEME_ATTRIBUTE = "data-theme";

function block(selector: string, entries: Array<[string, string]>): string {
  const body = entries.map(([name, value]) => `  ${name}: ${value};`).join("\n");
  return `${selector} {\n${body}\n}`;
}

/**
 * Hoja de variables CSS completa, generada desde los tokens de TypeScript. Vite la inserta en
 * el <head> de index.html (ver vite.config.ts), asi la primera pintura ya tiene el tema correcto
 * y no hay destello. Orden de precedencia:
 *   1. :root                      -> Komorebi (claro) por defecto.
 *   2. prefers-color-scheme: dark -> Tsukimi, salvo que el lector haya fijado el claro.
 *   3. [data-theme="light|dark"]  -> eleccion explicita (ThemeContext). Sin `:root` a proposito:
 *      tambien aplica a un contenedor anidado (la galeria de desarrollo muestra ambos temas).
 */
export function buildThemeCss(): string {
  const light = themeEntries(THEMES.light);
  const dark = themeEntries(THEMES.dark);
  return [
    block(":root", [...light, ...typographyEntries(), ...geometryEntries()]),
    `@media (prefers-color-scheme: dark) {\n${block(`:root:not([${THEME_ATTRIBUTE}="light"])`, dark)}\n}`,
    block(`[${THEME_ATTRIBUTE}="light"]`, light),
    block(`[${THEME_ATTRIBUTE}="dark"]`, dark),
    ":root { color-scheme: light dark; }",
    `[${THEME_ATTRIBUTE}="light"] { color-scheme: light; }`,
    `[${THEME_ATTRIBUTE}="dark"] { color-scheme: dark; }`,
  ].join("\n");
}
