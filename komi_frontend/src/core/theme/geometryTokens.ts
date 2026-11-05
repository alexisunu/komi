// Geometria, espaciado, elevacion y movimiento (SRS 9.1, 9.4 y 10). Archivo adicional a 13.2
// (SRS 18, punto 18): evita dispersar estos valores en los componentes.

export const GEOMETRY = {
  "space-1": "8px",
  "space-2": "16px",
  "space-3": "24px",
  "space-4": "32px",
  "space-6": "48px",
  "screen-margin": "24px",
  "radius-pill": "999px",
  "radius-card": "20px",
  "radius-input": "12px",
  "radius-sheet": "28px",
  "radius-bubble": "18px",
  // Sombra difusa calida para modales (SRS 9.4).
  "shadow-modal": "0px 8px 24px rgba(44, 48, 46, 0.06)",
  // Transiciones lentas de 300 a 400 ms ease-out (SRS 9.1).
  "transition-theme": "300ms ease-out",
  "transition-ui": "350ms ease-out",
  "nav-height": "64px",
  // Anillo de foco visible para teclado y lector de pantalla (accesibilidad).
  // Solo el grosor: el color se resuelve en cada elemento para respetar temas anidados.
  "focus-ring-width": "2px",
  "focus-offset": "3px",
  "touch-target": "44px",
  // Botones (SRS 10.1).
  "button-height": "56px",
  "button-secondary-height": "48px",
  "button-min-width": "220px",
} as const;

/** Grosor de trazo de los iconos (SRS 9.4, CLAUDE.md 5). Se pasa como prop a lucide-react. */
export const ICON_STROKE_WIDTH = 1.75;

export function geometryEntries(): Array<[string, string]> {
  return Object.entries(GEOMETRY).map(([name, value]) => [`--${name}`, value]);
}
