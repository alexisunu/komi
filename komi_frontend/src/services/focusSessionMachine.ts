// Maquina de estados PURA del temporizador de lectura (RF-02, FA-3.1 a FA-3.3). No toca el DOM,
// ni Dexie, ni relojes: recibe `now` (ms) como argumento. Reglas (SRS 19.14):
//   - El tiempo sale de marcas de tiempo (`now - startedAt`), nunca de contar ticks.
//   - La gracia de 15 s se mide POR CADA SALIDA (cada `hidden` empieza de cero). Pasar de
//     15 000 ms invalida; exactamente 15 000 ms sigue valido.
//   - El tiempo fuera cuenta como tiempo de lectura si se vuelve a tiempo.
//   - Al volver se evalua PRIMERO la gracia y despues el vencimiento: una salida larga invalida
//     aunque el plazo ya hubiera vencido mientras estaba oculta.
//   - Un reloj que retrocede nunca da tiempos negativos.
//   - `lastSeen` cubre el cierre forzado sin evento `hidden`: al reabrir se usa como referencia.

import { MIN_VALID_SEC } from "../data/local_db/sessionRules";

export const GRACE_MS = 15_000;
export const HEARTBEAT_MS = 5_000;

export interface ActiveSession {
  sessionId: string;
  bookId: string;
  plannedSec: number;
  /** Date.now() al iniciar. */
  startedAt: number;
  /** Hora de pared local de inicio, para la racha (SRS 16, punto 1). */
  startedAtLocal: string;
  /** Marca de la salida en curso, o null si la pagina esta visible. */
  hiddenAt: number | null;
  /** Ultima marca en que se vio la pagina viva (latido cada ~5 s y en pagehide). */
  lastSeen: number;
  /** Segundos finales cuando la sesion ya termino pero aun no se guarda (anticipada o completa). */
  finalSec: number | null;
}

export type Resolution =
  | { kind: "running" }
  | { kind: "grace"; graceRemainingMs: number }
  | { kind: "completed"; actualSec: number }
  | { kind: "early"; actualSec: number }
  | { kind: "invalidated"; actualSec: number };

export interface EvaluateOptions {
  /** La pagina esta visible ahora (o la app se acaba de reabrir). */
  visible: boolean;
  /** Reapertura tras recarga o cierre forzado: sin `hiddenAt`, la referencia es `lastSeen`. */
  reopened?: boolean;
}

export const plannedMs = (a: Pick<ActiveSession, "plannedSec">): number => a.plannedSec * 1000;

/** Tiempo transcurrido desde el inicio, nunca negativo ni mayor que el programado. */
export function elapsedMs(a: ActiveSession, now: number): number {
  return Math.min(plannedMs(a), Math.max(0, now - a.startedAt));
}

export function remainingMs(a: ActiveSession, now: number): number {
  return plannedMs(a) - elapsedMs(a, now);
}

/** Segundos de lectura en primer plano hasta `ref`, enteros y dentro de [0, programado]. */
export function foregroundSec(a: ActiveSession, ref: number): number {
  const sec = Math.floor(Math.max(0, ref - a.startedAt) / 1000);
  return Math.min(a.plannedSec, sec);
}

/** Calcula en que estado esta la sesion en `now`. Es la unica funcion que decide. */
export function evaluate(a: ActiveSession, now: number, options: EvaluateOptions): Resolution {
  if (a.finalSec !== null) {
    return a.finalSec >= a.plannedSec
      ? { kind: "completed", actualSec: a.plannedSec }
      : { kind: "early", actualSec: a.finalSec };
  }

  // Referencia de la salida: la marca de `hidden`; sin ella, solo tras una reapertura, `lastSeen`.
  const ref = a.hiddenAt ?? (options.reopened ? a.lastSeen : now);
  const away = Math.max(0, now - ref);

  if (away > GRACE_MS) {
    return { kind: "invalidated", actualSec: foregroundSec(a, ref) };
  }
  if (!options.visible && a.hiddenAt !== null) {
    return { kind: "grace", graceRemainingMs: GRACE_MS - away };
  }
  if (now - a.startedAt >= plannedMs(a)) {
    return { kind: "completed", actualSec: a.plannedSec };
  }
  return { kind: "running" };
}

/** La pagina pasa a oculta: empieza una salida nueva (la gracia no se acumula). */
export function applyHidden(a: ActiveSession, now: number): ActiveSession {
  if (a.finalSec !== null || a.hiddenAt !== null) return a;
  return { ...a, hiddenAt: now, lastSeen: now };
}

/** La pagina vuelve a estar visible y la sesion sigue: se cierra la salida. */
export function applyVisible(a: ActiveSession, now: number): ActiveSession {
  return { ...a, hiddenAt: null, lastSeen: now };
}

export function applyHeartbeat(a: ActiveSession, now: number): ActiveSession {
  return { ...a, lastSeen: now };
}

/** Pasaron al menos HEARTBEAT_MS desde el ultimo latido guardado (o el reloj retrocedio). */
export function heartbeatDue(lastPersisted: number, now: number): boolean {
  return now < lastPersisted || now - lastPersisted >= HEARTBEAT_MS;
}

export function applyFinal(a: ActiveSession, sec: number): ActiveSession {
  return { ...a, finalSec: Math.min(a.plannedSec, Math.max(0, Math.floor(sec))) };
}

/**
 * "Terminar sesion" (FA-3.3, regla unica): solo dice cuantos segundos van y si ya hay 5 minutos.
 * Con menos, la interfaz avisa que no se guardara (salvo que el libro llegue al 100 %, caso que
 * decide el lector).
 */
export function peekFinish(a: ActiveSession, now: number): { actualSec: number; enough: boolean } {
  const actualSec = foregroundSec(a, Math.min(now, a.startedAt + plannedMs(a)));
  return { actualSec, enough: actualSec >= MIN_VALID_SEC };
}

function isNum(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Lee el JSON guardado en `meta.active_session`; todo lo raro se descarta (null). */
export function parseActiveSession(raw: unknown): ActiveSession | null {
  if (typeof raw !== "string") return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const r = data as Record<string, unknown>;
  const hiddenAt = r.hiddenAt === null ? null : r.hiddenAt;
  const finalSec = r.finalSec === null ? null : r.finalSec;
  if (
    typeof r.sessionId !== "string" ||
    typeof r.bookId !== "string" ||
    typeof r.startedAtLocal !== "string" ||
    !isNum(r.plannedSec) ||
    !isNum(r.startedAt) ||
    !isNum(r.lastSeen) ||
    (hiddenAt !== null && !isNum(hiddenAt)) ||
    (finalSec !== null && !isNum(finalSec)) ||
    r.plannedSec <= 0
  ) {
    return null;
  }
  return {
    sessionId: r.sessionId,
    bookId: r.bookId,
    plannedSec: r.plannedSec,
    startedAt: r.startedAt,
    startedAtLocal: r.startedAtLocal,
    hiddenAt,
    lastSeen: r.lastSeen,
    finalSec,
  };
}
