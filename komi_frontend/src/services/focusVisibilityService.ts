// Servicio del temporizador de lectura: conecta la maquina pura (focusSessionMachine) con Page
// Visibility, el reloj y `meta.active_session`. Los eventos del navegador solo avisan; cada
// decision sale de comparar marcas de tiempo, asi que una pestaña suspendida por Safari no
// descuadra nada (CLAUDE.md 6).
//
// El registro `active_session` se guarda en cada transicion y con un latido de ~5 s mientras la
// pagina esta visible; se borra con `close()` cuando la sesion ya se guardo o se cancelo.
// `dispose()` NO lo borra: es lo que permite retomar la sesion tras una recarga.

import { InvalidSessionError } from "../data/local_db/errors";
import {
  formatLocalWallClock,
  isUuid,
  MAX_PLANNED_SEC,
  MIN_PLANNED_SEC,
  MIN_VALID_SEC,
} from "../data/local_db/sessionRules";
import {
  applyFinal,
  applyHeartbeat,
  applyHidden,
  applyVisible,
  peekFinish,
  elapsedMs,
  evaluate,
  GRACE_MS,
  heartbeatDue,
  remainingMs,
  type ActiveSession,
  type Resolution,
} from "./focusSessionMachine";

export type FocusPhase = "running" | "grace" | "completed" | "early" | "invalidated";

export interface FocusSnapshot {
  phase: FocusPhase;
  /** Milisegundos que faltan (0 al terminar). */
  remainingMs: number;
  elapsedMs: number;
  plannedSec: number;
  /** Solo en `grace`: lo que queda de los 15 s de esta salida. */
  graceRemainingMs: number;
  /** Segundos finales cuando la fase ya es terminal. */
  actualSec: number | null;
  sessionId: string;
  bookId: string;
}

export interface ActiveSessionStore {
  load(): Promise<ActiveSession | null>;
  save(session: ActiveSession): Promise<void>;
  clear(): Promise<void>;
}

export interface FocusDocument {
  readonly visibilityState: DocumentVisibilityState;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

export interface FocusWindow {
  addEventListener(type: "pagehide", listener: () => void): void;
  removeEventListener(type: "pagehide", listener: () => void): void;
}

export interface FocusServiceDeps {
  now: () => number;
  doc: FocusDocument;
  win: FocusWindow;
  store: ActiveSessionStore;
  /** Guarda la sesion invalidada (sin tocar el progreso del libro). */
  saveInvalidated: (session: ActiveSession, actualSec: number) => Promise<void>;
}

export interface StartInput {
  sessionId: string;
  bookId: string;
  plannedSec: number;
}

export function createFocusVisibilityService(deps: FocusServiceDeps) {
  const { now, doc, win, store } = deps;

  let active: ActiveSession | null = null;
  let attached = false;
  let lastPersistedSeen = 0;
  let settled: Resolution | null = null;
  let cached: FocusSnapshot | null = null;
  let queue: Promise<void> = Promise.resolve();
  const listeners = new Set<() => void>();

  /** Las escrituras a Dexie van en orden aunque se pidan seguidas. */
  function enqueue(task: () => Promise<void>): Promise<void> {
    queue = queue.then(task, task);
    return queue;
  }

  function persist(): void {
    const record = active;
    if (!record) return;
    lastPersistedSeen = record.lastSeen;
    void enqueue(() => store.save(record)).catch(() => {
      // Si Dexie falla, el temporizador sigue (esta en memoria); solo se pierde la recuperacion.
    });
  }

  function snapshotOf(record: ActiveSession, resolution: Resolution, at: number): FocusSnapshot {
    const terminal =
      resolution.kind === "completed" ||
      resolution.kind === "early" ||
      resolution.kind === "invalidated";
    const elapsed = terminal ? resolution.actualSec * 1000 : elapsedMs(record, at);
    return {
      phase: resolution.kind,
      elapsedMs: elapsed,
      remainingMs: terminal ? 0 : remainingMs(record, at),
      plannedSec: record.plannedSec,
      graceRemainingMs: resolution.kind === "grace" ? resolution.graceRemainingMs : 0,
      actualSec: terminal ? resolution.actualSec : null,
      sessionId: record.sessionId,
      bookId: record.bookId,
    };
  }

  /** Reutiliza el objeto si no cambio nada visible (segundo entero y fase), para no repintar. */
  function publish(next: FocusSnapshot | null): void {
    const prev = cached;
    const same =
      prev !== null &&
      next !== null &&
      prev.phase === next.phase &&
      Math.ceil(prev.remainingMs / 1000) === Math.ceil(next.remainingMs / 1000) &&
      Math.ceil(prev.graceRemainingMs / 1000) === Math.ceil(next.graceRemainingMs / 1000) &&
      prev.actualSec === next.actualSec &&
      prev.sessionId === next.sessionId;
    if (same || (prev === null && next === null)) return;
    cached = next;
    listeners.forEach((listener) => listener());
  }

  /** Evalua en `at`, aplica la transicion y devuelve el estado. */
  async function step(options: { visible: boolean; reopened?: boolean }): Promise<Resolution> {
    const record = active;
    if (!record) return settled ?? { kind: "running" };
    const at = now();
    const resolution = evaluate(record, at, options);

    if (resolution.kind === "invalidated") {
      settled = resolution;
      publish(snapshotOf(record, resolution, at));
      active = null;
      detach();
      await saveInvalidated(record, resolution.actualSec);
      return resolution;
    }
    if (resolution.kind === "completed" && record.finalSec === null) {
      active = applyFinal(record, record.plannedSec);
      settled = resolution;
      persist();
    } else if (resolution.kind === "running" && record.hiddenAt !== null) {
      active = applyVisible(record, at);
      persist();
    } else if (resolution.kind === "running" && heartbeatDue(lastPersistedSeen, at)) {
      active = applyHeartbeat(record, at);
      persist();
    }
    if (active) publish(snapshotOf(active, resolution, at));
    return resolution;
  }

  async function saveInvalidated(record: ActiveSession, actualSec: number): Promise<void> {
    try {
      // Una invalidada de menos de 5 minutos no se guarda (regla unica de duracion, FA-3.3).
      if (actualSec >= MIN_VALID_SEC) await deps.saveInvalidated(record, actualSec);
      await enqueue(() => store.clear());
    } catch {
      // Se conserva el registro: `recover()` volvera a intentarlo al reabrir.
    }
  }

  function onVisibility(): void {
    if (!active) return;
    if (doc.visibilityState === "hidden") {
      const at = now();
      active = applyHidden(active, at);
      persist();
      publish(snapshotOf(active, evaluate(active, at, { visible: false }), at));
      return;
    }
    void step({ visible: true });
  }

  function onPageHide(): void {
    if (!active || active.finalSec !== null) return;
    active = applyHeartbeat(active, now());
    persist();
  }

  function attach(): void {
    if (attached) return;
    attached = true;
    doc.addEventListener("visibilitychange", onVisibility);
    win.addEventListener("pagehide", onPageHide);
  }

  function detach(): void {
    if (!attached) return;
    attached = false;
    doc.removeEventListener("visibilitychange", onVisibility);
    win.removeEventListener("pagehide", onPageHide);
  }

  return {
    /** Inicia una sesion nueva y la deja guardada de inmediato. */
    async start(input: StartInput): Promise<FocusSnapshot> {
      if (active) throw new Error("Ya hay una sesion de lectura en curso.");
      if (!isUuid(input.sessionId)) {
        throw new InvalidSessionError("id", "El id de la sesion debe ser un UUID.");
      }
      if (
        !Number.isInteger(input.plannedSec) ||
        input.plannedSec < MIN_PLANNED_SEC ||
        input.plannedSec > MAX_PLANNED_SEC
      ) {
        throw new InvalidSessionError(
          "planned_duration_sec",
          "La duracion programada va de 5 a 120 minutos.",
        );
      }
      const at = now();
      settled = null;
      active = {
        sessionId: input.sessionId,
        bookId: input.bookId,
        plannedSec: input.plannedSec,
        startedAt: at,
        startedAtLocal: formatLocalWallClock(new Date(at)),
        hiddenAt: null,
        lastSeen: at,
        finalSec: null,
      };
      cached = null;
      await enqueue(() => store.save(active as ActiveSession));
      lastPersistedSeen = at;
      attach();
      const first = snapshotOf(active, { kind: "running" }, at);
      publish(first);
      return first;
    },

    /**
     * Retoma el registro guardado tras una recarga o un cierre forzado. Devuelve null si no hay
     * sesion. Una sesion con mas de 15 s sin verse queda invalidada y guardada.
     */
    async recover(): Promise<FocusSnapshot | null> {
      if (active) return cached;
      const stored = await store.load();
      if (!stored) return null;
      active = stored;
      settled = null;
      cached = null;
      lastPersistedSeen = stored.lastSeen;
      const resolution = await step({ visible: true, reopened: true });
      if (resolution.kind === "invalidated") return cached;
      attach();
      return cached;
    },

    /** Avanza el reloj: lo llama el repintado (~250 ms). Solo lee marcas de tiempo. */
    async tick(): Promise<void> {
      if (!active) return;
      await step({ visible: doc.visibilityState !== "hidden" });
    },

    getSnapshot: (): FocusSnapshot | null => cached,

    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    /** Segundos y si ya hay 5 minutos, sin cambiar nada (FA-3.3). */
    peekFinish(): { actualSec: number; enough: boolean } | null {
      return active ? peekFinish(active, now()) : null;
    },

    /** Cierra la sesion con el tiempo leido hasta ahora. Queda guardada para el cierre. */
    acceptFinish(): FocusSnapshot | null {
      if (!active || active.finalSec !== null) return cached;
      const at = now();
      const { actualSec } = peekFinish(active, at);
      active = applyFinal(active, actualSec);
      const resolution: Resolution = {
        kind: actualSec >= active.plannedSec ? "completed" : "early",
        actualSec,
      };
      settled = resolution;
      persist();
      publish(snapshotOf(active, resolution, at));
      return cached;
    },

    /** Borra el registro (sesion guardada, cancelada o descartada) y deja de escuchar. */
    async close(): Promise<void> {
      active = null;
      settled = null;
      detach();
      publish(null);
      await enqueue(() => store.clear());
    },

    /** Deja de escuchar sin borrar el registro (desmontaje): la sesion se puede retomar. */
    dispose(): void {
      detach();
      active = null;
      listeners.clear();
    },

    graceMs: GRACE_MS,
  };
}

export type FocusVisibilityService = ReturnType<typeof createFocusVisibilityService>;
