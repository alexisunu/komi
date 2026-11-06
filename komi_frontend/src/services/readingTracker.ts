// Registro de lo leido en una sesion EPUB (CU-04, RF-03, RF-05). Logica pura, sin epubjs ni DOM:
// el lector le pasa cada posicion y este modulo decide que se conserva.
//
// Reglas:
//   - CFI y porcentaje siempre quedan con el ULTIMO valor. El porcentaje solo existe si hay
//     `locations` (llega como `null` si no): nunca se inventa uno provisional.
//   - El extracto acumula los textos visibles, sin duplicados, y se recorta por el INICIO al pasar
//     de 20 000 caracteres (el servidor lo limita igual; lo mas reciente es lo que se conversa).
//   - La escritura a disco la limita `createProgressWriter` (una vez cada ~10 s y en pagehide).

export const MAX_EXCERPT_CHARS = 20_000;
export const PROGRESS_WRITE_MS = 10_000;
/** Un fragmento mas corto que esto (numeros de pagina, titulos sueltos) no aporta contexto. */
const MIN_CHUNK_CHARS = 20;

export interface ReadingProgress {
  sessionId: string;
  /** CFI del inicio de la pagina visible: donde se reabre el libro. */
  cfi: string | null;
  /** 0 a 100, truncado a 2 decimales. `null` mientras no haya `locations`. */
  percentage: number | null;
  excerpt: string;
  updatedAt: number;
}

/** Fraccion 0..1 de epubjs a porcentaje truncado: 0.99999 -> 99.99, nunca 100 sin llegar al final. */
export function toPercentage(fraction: number | null): number | null {
  if (fraction === null || !Number.isFinite(fraction)) return null;
  const clamped = Math.min(Math.max(fraction, 0), 1);
  // toPrecision(12) quita el ruido binario antes de truncar (como progressMath.truncateProgress).
  return Math.trunc(Number((clamped * 10_000).toPrecision(12))) / 100;
}

/** "Ultima posicion": 100 % exacto segun las `locations`. 99,99 no cuenta (FA-3.3). */
export function isFinished(percentage: number | null): boolean {
  return percentage !== null && percentage >= 100;
}

/**
 * FA-3.3: "Terminé antes de tiempo" vale con el 50 % del tiempo o con el libro terminado. Sin
 * `locations` (porcentaje nulo) no se puede afirmar que se termino.
 */
export function earlyFinishAllowed(
  early: { belowHalf: boolean } | null,
  percentage: number | null,
): boolean {
  return early !== null && (!early.belowHalf || isFinished(percentage));
}

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export interface ReadingTracker {
  /** Registra la posicion visible. Devuelve si cambio algo que valga la pena guardar. */
  record(input: { cfi: string; percentage: number | null; text: string }): boolean;
  snapshot(): ReadingProgress;
  /** Reanuda con lo guardado de una sesion retomada tras recargar. */
  restore(saved: ReadingProgress): void;
}

export function createReadingTracker(sessionId: string, now: () => number): ReadingTracker {
  let cfi: string | null = null;
  let percentage: number | null = null;
  let excerpt = "";

  return {
    record(input) {
      let changed = false;
      if (input.cfi !== cfi) {
        cfi = input.cfi;
        changed = true;
      }
      // Un porcentaje nulo (sin locations) NO borra el ultimo valido ni se sustituye por otro.
      if (input.percentage !== null && input.percentage !== percentage) {
        percentage = input.percentage;
        changed = true;
      }
      const chunk = normalize(input.text);
      if (chunk.length >= MIN_CHUNK_CHARS && !excerpt.includes(chunk)) {
        excerpt = excerpt === "" ? chunk : `${excerpt} ${chunk}`;
        if (excerpt.length > MAX_EXCERPT_CHARS) excerpt = excerpt.slice(excerpt.length - MAX_EXCERPT_CHARS);
        changed = true;
      }
      return changed;
    },

    snapshot() {
      return { sessionId, cfi, percentage, excerpt, updatedAt: now() };
    },

    restore(saved) {
      if (saved.sessionId !== sessionId) return;
      cfi = saved.cfi;
      percentage = saved.percentage;
      excerpt = saved.excerpt.slice(-MAX_EXCERPT_CHARS);
    },
  };
}

/** Lee el registro guardado; cualquier cosa rara es `null` (se ignora, no rompe la sesion). */
export function parseReadingProgress(raw: unknown): ReadingProgress | null {
  if (typeof raw !== "string") return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const { sessionId, cfi, percentage, excerpt, updatedAt } = record;
  if (typeof sessionId !== "string" || sessionId === "") return null;
  if (cfi !== null && typeof cfi !== "string") return null;
  if (percentage !== null && (typeof percentage !== "number" || !(percentage >= 0 && percentage <= 100))) return null;
  if (typeof excerpt !== "string" || typeof updatedAt !== "number") return null;
  return { sessionId, cfi, percentage, excerpt: excerpt.slice(-MAX_EXCERPT_CHARS), updatedAt };
}

export interface ProgressWriterDeps {
  now: () => number;
  save: (progress: ReadingProgress) => Promise<void>;
  intervalMs?: number;
}

/**
 * Limita la frecuencia de escritura: una vez cada `intervalMs` como maximo. `flushIfDue` se llama
 * a menudo (un temporizador del lector); `flush` escribe ya (pagehide y fin de sesion).
 */
export function createProgressWriter(deps: ProgressWriterDeps) {
  const interval = deps.intervalMs ?? PROGRESS_WRITE_MS;
  let pending: ReadingProgress | null = null;
  let lastWrite = Number.NEGATIVE_INFINITY;

  async function write(): Promise<void> {
    if (!pending) return;
    const progress = pending;
    pending = null;
    lastWrite = deps.now();
    try {
      await deps.save(progress);
    } catch {
      // Se reintenta con el siguiente cambio; el registro es de mejor esfuerzo.
      pending ??= progress;
    }
  }

  return {
    /** Anota el ultimo estado. Escribe de inmediato si ya paso el intervalo. */
    update(progress: ReadingProgress): Promise<void> {
      pending = progress;
      return deps.now() - lastWrite >= interval ? write() : Promise.resolve();
    },
    /** Escribe si hay algo pendiente y ya toca. */
    flushIfDue(): Promise<void> {
      return pending && deps.now() - lastWrite >= interval ? write() : Promise.resolve();
    },
    /** Escribe ya lo pendiente (pagehide, desmontaje, fin de sesion). */
    flush(): Promise<void> {
      return write();
    },
    hasPending(): boolean {
      return pending !== null;
    },
  };
}

export type ProgressWriter = ReturnType<typeof createProgressWriter>;
