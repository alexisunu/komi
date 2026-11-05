// Mantiene los <meta name="theme-color"> en sintonia con el tema activo. index.html trae uno por
// esquema del sistema (con `media`); si el lector elige un tema distinto al del sistema, ambos
// toman el color del tema elegido para que la barra del navegador no desentone.

import { THEMES, type ThemeId } from "./colorTokens";

export function syncThemeColor(theme: ThemeId, doc: Document = document): void {
  const color = THEMES[theme].brand["bg-primary"];
  doc.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
    meta.setAttribute("content", color);
  });
}
