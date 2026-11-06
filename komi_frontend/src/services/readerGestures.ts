// Gestos del lector EPUB (funciones puras). Toque: tercio izquierdo = atras, tercio derecho =
// adelante, centro = nada (queda libre para mostrar controles en el futuro). Deslizar: horizontal
// y claramente mas ancho que alto.

export type TurnAction = "prev" | "next" | null;

/** Un toque: `x` y `width` en la misma unidad (coordenadas del iframe). */
export function tapAction(x: number, width: number): TurnAction {
  if (!(width > 0) || !Number.isFinite(x)) return null;
  const ratio = x / width;
  if (ratio < 1 / 3) return "prev";
  if (ratio > 2 / 3) return "next";
  return null;
}

export const SWIPE_MIN_PX = 40;

/** Deslizar a la izquierda pasa a la pagina siguiente; a la derecha, a la anterior. */
export function swipeAction(dx: number, dy: number): TurnAction {
  if (Math.abs(dx) < SWIPE_MIN_PX) return null;
  if (Math.abs(dx) < Math.abs(dy) * 1.5) return null; // mas vertical que horizontal: es un desplazamiento
  return dx < 0 ? "next" : "prev";
}

/** Teclas de flecha y espacio (escritorio y teclado Bluetooth). */
export function keyAction(key: string): TurnAction {
  if (key === "ArrowRight" || key === "PageDown" || key === " ") return "next";
  if (key === "ArrowLeft" || key === "PageUp") return "prev";
  return null;
}
