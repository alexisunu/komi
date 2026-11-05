// Registro del Service Worker (vite-plugin-pwa con `autoUpdate`, injectRegister: false). Se hace a
// mano con workbox-window para decidir cuando recargar: la recarga pasa por la puerta
// (reloadGate), que la Fase 4 bloqueara mientras haya una sesion de lectura activa.

import type { ReloadGate } from "./reloadGate";

/** Parte de `Workbox` (workbox-window) que usamos; permite probarlo sin navegador. */
export interface WorkboxLike {
  addEventListener: (type: "activated", listener: (event: { isUpdate?: boolean }) => void) => void;
  register: () => Promise<unknown>;
}

export interface RegisterOptions {
  /** `"serviceWorker" in navigator`. */
  supported: boolean;
  create: () => WorkboxLike;
  gate: ReloadGate;
  log?: (message: string, error?: unknown) => void;
}

/** Devuelve true si se registro. Nunca lanza: sin Service Worker la app sigue en linea. */
export async function registerServiceWorker({
  supported,
  create,
  gate,
  log = (message, error) => console.warn(message, error),
}: RegisterOptions): Promise<boolean> {
  if (!supported) return false;
  try {
    const workbox = create();
    workbox.addEventListener("activated", (event) => {
      // La primera instalacion no es una actualizacion: no hay nada que recargar.
      if (event.isUpdate) gate.request();
    });
    await workbox.register();
    return true;
  } catch (error) {
    log("[komi] No se pudo registrar el Service Worker.", error);
    return false;
  }
}
