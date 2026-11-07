// Despertar al servidor (Fase 5, SRS 19.23). El plan gratuito de Render duerme el servicio tras
// ~15 min sin trafico y tarda hasta ~60 s en volver: la primera peticion se queda esperando o
// falla. Al abrir la app se hace un sondeo ligero (GET /health/) SIN bloquear la interfaz, y el
// chat espera a que responda antes de sincronizar la sesion.
//
// Estados: `idle` (no se sabe o caduco), `waking` (el sondeo tarda: "Despertando a Komi"),
// `awake` (respondio hace menos de 10 min) y `offline` (sin red o sin respuesta en 90 s).
//
// Una respuesta HTTP que no sea 502, 503 o 504 viene de la propia aplicacion: esta despierta.
// Un fallo SIN respuesta con la red del dispositivo activa no se toma por "sin conexion": un 502
// de un proxy que arranca llega sin cabeceras CORS y el navegador lo ve como fallo de red. Se
// sigue sondeando hasta agotar el presupuesto de 90 s. Con `navigator.onLine === false` se para
// en seguida. Nunca se escribe nada del perfil: la ruta no necesita X-Profile-Id.

import { ApiError, type ApiClient } from "./apiClient";

export type WakeState = "idle" | "waking" | "awake" | "offline";

/** Presupuesto total del sondeo y espera maxima del chat (arranque en frio). */
export const WAKE_BUDGET_MS = 90_000;
/** Hasta aqui un servidor que responde rapido no muestra "Despertando a Komi". */
export const WAKE_SLOW_AFTER_MS = 2_500;
/** El proxy de la plataforma responde esto mientras el servicio arranca; cualquier otra respuesta es de la app. */
export const STARTING_STATUSES: ReadonlySet<number> = new Set([502, 503, 504]);
/** Pausa entre sondeos fallidos. */
export const WAKE_RETRY_MS = 3_000;
/** Lo que dura "despierto": menos que los ~15 min tras los que Render duerme el servicio. */
export const WAKE_FRESH_MS = 10 * 60_000;
export const HEALTH_PATH = "/health/";

export interface WakeDeps {
  api: Pick<ApiClient, "get" | "isConfigured">;
  now?: () => number;
  /** Pausa entre sondeos; en pruebas se reemplaza. */
  wait?: (ms: number) => Promise<void>;
  isOnline?: () => boolean;
}

export function createWakeService(deps: WakeDeps) {
  const { api } = deps;
  const now = deps.now ?? (() => Date.now());
  const wait = deps.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const isOnline = deps.isOnline ?? (() => (typeof navigator === "undefined" ? true : navigator.onLine !== false));

  let probing: Promise<void> | null = null;
  let shown: WakeState = "idle";
  let lastOkAt: number | null = null;
  const listeners = new Set<() => void>();

  function setShown(next: WakeState) {
    if (shown === next) return;
    shown = next;
    for (const listener of [...listeners]) listener();
  }

  function isFresh(): boolean {
    return lastOkAt !== null && now() - lastOkAt < WAKE_FRESH_MS;
  }

  /** Estado actual; `awake` caduca solo a los 10 min. */
  function state(): WakeState {
    if (shown === "awake" && !isFresh()) return "idle";
    return shown;
  }

  async function probe(): Promise<void> {
    const startedAt = now();
    // Una respuesta rapida nunca muestra "Despertando a Komi": solo si el sondeo tarda.
    const slowTimer = setTimeout(() => {
      if (probing !== null) setShown("waking");
    }, WAKE_SLOW_AFTER_MS);
    try {
      for (;;) {
        const remaining = WAKE_BUDGET_MS - (now() - startedAt);
        if (remaining <= 0) {
          setShown("offline");
          return;
        }
        try {
          await api.get(HEALTH_PATH, { timeoutMs: remaining });
          lastOkAt = now();
          setShown("awake");
          return;
        } catch (error) {
          if (error instanceof ApiError) {
            if (error.kind === "not_configured") {
              setShown("idle");
              return;
            }
            // Contesto la propia aplicacion (un 404 de una version vieja, un 500): esta despierta.
            // Solo 502, 503 y 504 son del proxy mientras arranca.
            if (error.kind === "http" && !STARTING_STATUSES.has(error.status ?? 0)) {
              lastOkAt = now();
              setShown("awake");
              return;
            }
            if (error.kind === "network" && !isOnline()) {
              setShown("offline");
              return;
            }
          }
          // 502/503/504, tiempo agotado o fallo de red con red activa: probablemente arrancando.
          if (isOnline()) setShown("waking");
          await wait(Math.min(WAKE_RETRY_MS, Math.max(0, WAKE_BUDGET_MS - (now() - startedAt))));
        }
      }
    } finally {
      clearTimeout(slowTimer);
    }
  }

  /** Empieza el sondeo si hace falta. No bloquea, no lanza y no repite uno en curso. */
  function start(): Promise<void> {
    if (!api.isConfigured || isFresh()) return Promise.resolve();
    if (probing) return probing;
    probing = probe()
      .catch(() => setShown("offline"))
      .finally(() => {
        probing = null;
      });
    return probing;
  }

  /**
   * Espera a que el servidor responda (hasta `maxMs`). Verdadero si esta despierto; falso si no
   * hay servidor, no hay red o no respondio a tiempo: el llamador sigue y su propio error lo dira.
   */
  async function ensureAwake(maxMs: number = WAKE_BUDGET_MS): Promise<boolean> {
    if (!api.isConfigured) return false;
    if (isFresh()) return true;
    const running = start();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const limit = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, maxMs);
    });
    try {
      await Promise.race([running, limit]);
    } finally {
      clearTimeout(timer);
    }
    return isFresh();
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return { state, subscribe, start, ensureAwake };
}

export type WakeService = ReturnType<typeof createWakeService>;

/**
 * Despierta al servidor al abrir la app, al volver la red y al volver a la pestana (puede haber
 * pasado mas de 10 min). Cuando pasa de `waking` a `awake` llama a `onAwake` (por ejemplo, para
 * subir lo que se quedo pendiente). Devuelve la funcion que lo detiene.
 */
export function watchWake(
  wake: Pick<WakeService, "start" | "state" | "subscribe">,
  target: Pick<Window, "addEventListener" | "removeEventListener">,
  doc: Pick<Document, "addEventListener" | "removeEventListener" | "visibilityState">,
  onAwake?: () => void,
): () => void {
  let previous = wake.state();
  const unsubscribe = wake.subscribe(() => {
    const current = wake.state();
    if (previous === "waking" && current === "awake") onAwake?.();
    previous = current;
  });
  const attempt = () => void wake.start();
  const onVisible = () => {
    if (doc.visibilityState === "visible") attempt();
  };
  target.addEventListener("online", attempt);
  doc.addEventListener("visibilitychange", onVisible);
  attempt();
  return () => {
    unsubscribe();
    target.removeEventListener("online", attempt);
    doc.removeEventListener("visibilitychange", onVisible);
  };
}
