// Pantalla encendida durante la sesion (SRS 19.12). Pide `navigator.wakeLock.request("screen")` al
// iniciar, lo libera al terminar y lo vuelve a pedir cuando la pagina vuelve a estar visible (el
// sistema lo libera solo al ocultarse). Si la API no existe o falla, no hace ruido: la sesion
// sigue igual. Un bloqueo manual de la pantalla sigue invalidando pasados 15 s.

export interface WakeLockSentinelLike {
  release(): Promise<void>;
  addEventListener?(type: "release", listener: () => void): void;
}

export interface WakeLockNavigator {
  wakeLock?: { request(type: "screen"): Promise<WakeLockSentinelLike> };
}

export interface WakeLockDocument {
  readonly visibilityState: DocumentVisibilityState;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

export function createWakeLockService(nav: WakeLockNavigator, doc: WakeLockDocument) {
  let wanted = false;
  let sentinel: WakeLockSentinelLike | null = null;
  let requesting = false;

  async function request(): Promise<void> {
    const api = nav.wakeLock;
    if (!api || !wanted || sentinel || requesting || doc.visibilityState !== "visible") return;
    requesting = true;
    try {
      const granted = await api.request("screen");
      if (!wanted) {
        // Se pidio soltar mientras llegaba la respuesta.
        await granted.release().catch(() => {});
        return;
      }
      sentinel = granted;
      granted.addEventListener?.("release", () => {
        if (sentinel === granted) sentinel = null;
      });
    } catch {
      // Sin permiso o sin soporte: degradacion silenciosa.
    } finally {
      requesting = false;
    }
  }

  function onVisibility(): void {
    if (doc.visibilityState === "visible") void request();
  }

  return {
    /** Empieza a mantener la pantalla encendida. Seguro de llamar varias veces. */
    async acquire(): Promise<void> {
      if (!wanted) {
        wanted = true;
        doc.addEventListener("visibilitychange", onVisibility);
      }
      await request();
    },

    /** Deja de pedirlo y suelta el que haya. Seguro de llamar varias veces. */
    async release(): Promise<void> {
      if (wanted) doc.removeEventListener("visibilitychange", onVisibility);
      wanted = false;
      const current = sentinel;
      sentinel = null;
      if (current) await current.release().catch(() => {});
    },
  };
}

export type WakeLockService = ReturnType<typeof createWakeLockService>;
