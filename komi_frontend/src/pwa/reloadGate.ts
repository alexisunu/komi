// Puerta de recarga del Service Worker (SRS 18, punto 14). Con `autoUpdate`, una version nueva se
// activa sola y la pagina se recarga. Cualquier parte de la app puede pedir aplazar esa recarga
// con `block()` (la Fase 4 lo hara mientras el temporizador este activo). Al soltar el ultimo
// bloqueo, si habia una recarga pendiente, se hace entonces.

export interface ReloadGate {
  /** Aplaza la recarga. Devuelve la funcion que levanta ese bloqueo (idempotente). */
  block: () => () => void;
  /** Pide recargar: ahora si nadie bloquea, o al soltar el ultimo bloqueo. */
  request: () => void;
  isBlocked: () => boolean;
}

export function createReloadGate(reload: () => void): ReloadGate {
  let blockers = 0;
  let pending = false;

  return {
    block() {
      blockers += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        blockers -= 1;
        if (blockers === 0 && pending) {
          pending = false;
          reload();
        }
      };
    },
    request() {
      if (blockers > 0) {
        pending = true;
        return;
      }
      reload();
    },
    isBlocked: () => blockers > 0,
  };
}

/** Puerta de la app: recarga la pagina de verdad. */
export const reloadGate = createReloadGate(() => window.location.reload());
