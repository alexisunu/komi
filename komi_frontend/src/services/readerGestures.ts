// Gestos del lector EPUB (funciones puras). Toque: tercio izquierdo = atras, tercio derecho =
// adelante, centro = menu (la pantalla decide si lo atiende). Deslizar: horizontal
// y claramente mas ancho que alto.

export type TurnAction = "prev" | "next" | null;
/** Un toque tambien puede pedir el menu (tercio central). */
export type TapAction = TurnAction | "menu";

/** Un toque: `x` y `width` en la misma unidad (coordenadas del iframe). */
export function tapAction(x: number, width: number): TapAction {
  if (!(width > 0) || !Number.isFinite(x)) return null;
  const ratio = x / width;
  if (ratio < 1 / 3) return "prev";
  if (ratio > 2 / 3) return "next";
  return "menu";
}

/**
 * epubjs en modo paginado hace el iframe de un capitulo tan ancho como todas sus paginas juntas y
 * lo desplaza dentro del contenedor. `clientX` es relativo a ESE iframe, no a la pantalla: se pasa
 * a coordenadas del contenedor visible sumando donde queda hoy el borde izquierdo del iframe.
 */
export function toHostX(clientX: number, frameLeft: number, hostLeft: number): number {
  return frameLeft + clientX - hostLeft;
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
