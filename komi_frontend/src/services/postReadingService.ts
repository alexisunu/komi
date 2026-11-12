// Cierre de una sesion de lectura (CU-04). Lee el registro `active_session` y el avance de la
// lectura EPUB, guarda la sesion y el avance del libro en Dexie (una transaccion), recalcula la
// racha local y devuelve lo que la hoja post-lectura necesita mostrar. NO borra los registros de
// la sesion en curso ni suelta la puerta de recarga: eso lo hace quien llama (`focus.leave()`)
// solo cuando este guardado termino bien, para no perder nunca una sesion.

import { KomiLocalError } from "../data/local_db/errors";
import type { LocalBookRepository } from "../data/local_db/localBookRepository";
import type { LocalEpubRepository } from "../data/local_db/localEpubRepository";
import { META_KEYS, type LocalMetaRepository } from "../data/local_db/localMetaRepository";
import type { LocalSessionRepository } from "../data/local_db/localSessionRepository";
import {
  formatLocalWallClock,
  MIN_VALID_SEC,
  type CompleteSessionInput,
} from "../data/local_db/sessionRules";
import type { LocalBook, LocalSession } from "../data/local_db/types";
import type { ActiveSession } from "./focusSessionMachine";
import type { EpubService } from "./epubService";
import { computeStreak } from "./localStreak";
import type { ReadingProgress } from "./readingTracker";

export interface PostReadingDeps {
  /** `meta.active_session` ya interpretado. */
  loadActiveSession(): Promise<ActiveSession | null>;
  /** `meta.active_session_progress` ya interpretado. */
  loadProgress(): Promise<ReadingProgress | null>;
  books: Pick<LocalBookRepository, "getBook">;
  sessions: Pick<LocalSessionRepository, "completeSession" | "listSessionsBetween">;
  epubFiles: Pick<LocalEpubRepository, "getFile">;
  epub: Pick<EpubService, "percentageAt">;
  meta: Pick<LocalMetaRepository, "set">;
  now: () => number;
}

export type PreparedSession =
  | {
      kind: "ready";
      record: ActiveSession;
      /** Segundos finales de la sesion (siempre definidos aqui). */
      actualSec: number;
      book: LocalBook;
      /** Avance de lectura de ESTA sesion; uno huerfano de otra sesion se ignora. */
      progress: ReadingProgress | null;
      /** Menos de 5 minutos: solo vale si el libro se termino. */
      short: boolean;
    }
  | { kind: "missing"; reason: "record" | "book" };

export type SaveResult =
  | {
      kind: "saved";
      session: LocalSession;
      book: LocalBook;
      /** Progreso del libro antes de esta sesion (para la animacion). */
      before: number;
      solarBonus: boolean;
      /** Llego al 100 % con esta sesion. */
      bloomed: boolean;
      /** Racha a mostrar hoy. */
      streak: number;
      /** Falso si la sesion ya estaba guardada (mismo UUID): se reutiliza lo guardado. */
      created: boolean;
    }
  | { kind: "discarded" };

/** La pagina escrita no es valida para este libro: aviso gentil, la sesion sigue sin guardar. */
export class InvalidPageError extends Error {
  readonly totalPages: number;
  constructor(totalPages: number) {
    super(`La página debe estar entre 1 y ${totalPages}.`);
    this.name = "InvalidPageError";
    this.totalPages = totalPages;
  }
}

export interface SaveInput {
  /** Libro fisico: pagina alcanzada. */
  page?: number;
  /** EPUB sin `locations`: se avisa antes de generarlas (trabajo lento). */
  onPreparing?: () => void;
  onProgress?: (fraction: number) => void;
}

const FAR_PAST = "0000-01-01T00:00:00";
const FAR_FUTURE = "9999-12-31T23:59:59";

export function createPostReadingService(deps: PostReadingDeps) {
  async function epubFields(
    ready: Extract<PreparedSession, { kind: "ready" }>,
    options: SaveInput,
  ): Promise<Partial<CompleteSessionInput>> {
    const cfi = ready.progress?.cfi ?? null;
    let percentage = ready.progress?.percentage ?? null;
    let usable = true;
    if (percentage === null && cfi) {
      // Sin `locations` durante la sesion: se calcula el valor exacto ahora (SRS 19.7).
      try {
        const file = await deps.epubFiles.getFile(ready.book.id);
        if (file) {
          if (!file.locations) options.onPreparing?.();
          percentage = await deps.epub.percentageAt(file.data, cfi, file.locations, options.onProgress);
        }
      } catch {
        percentage = null;
      }
      usable = percentage !== null;
    }
    // Sin avance medible no se inventa uno: se conserva el guardado (la sesion sigue contando).
    const reported = percentage ?? ready.book.progress_percentage;
    const excerpt = ready.progress?.excerpt;
    return {
      progress_percentage: reported,
      ...(cfi && usable ? { last_epub_cfi: cfi } : {}),
      extracted_epub_excerpt: excerpt ? excerpt : null,
    };
  }

  /** Recalcula la racha desde las sesiones locales y la deja en `meta.streak_current`. */
  async function updateStreak(): Promise<number> {
    const sessions = await deps.sessions.listSessionsBetween(FAR_PAST, FAR_FUTURE);
    const today = formatLocalWallClock(new Date(deps.now())).slice(0, 10);
    const { effective } = computeStreak(sessions, today);
    try {
      await deps.meta.set(META_KEYS.streakCurrent, effective);
    } catch {
      // La sesion ya esta guardada; la racha se recalcula con la siguiente.
    }
    return effective;
  }

  return {
    /** Reune todo lo necesario para cerrar la sesion, sin escribir nada. */
    async prepare(sessionId: string, finalSecHint: number | null = null): Promise<PreparedSession> {
      const record = await deps.loadActiveSession();
      if (!record || record.sessionId !== sessionId) return { kind: "missing", reason: "record" };
      // `finalSec` se escribe en segundo plano al terminar: si la hoja llega primero, vale lo que
      // vio la pantalla (los mismos segundos que se estan escribiendo).
      const finalSec = record.finalSec ?? finalSecHint;
      if (finalSec === null) return { kind: "missing", reason: "record" };
      const book = await deps.books.getBook(record.bookId);
      if (!book) return { kind: "missing", reason: "book" };
      const saved = await deps.loadProgress().catch(() => null);
      const progress = saved && saved.sessionId === sessionId ? saved : null;
      return {
        kind: "ready",
        record,
        actualSec: finalSec,
        book,
        progress,
        short: finalSec < MIN_VALID_SEC,
      };
    },

    /**
     * Guarda la sesion y el avance del libro, y recalcula la racha. Idempotente por UUID: repetirlo
     * (por un reintento o una recarga) no duplica nada. Lanza `InvalidPageError` si la pagina no
     * vale y cualquier error de almacenamiento tal cual, para que la hoja ofrezca reintentar.
     */
    async save(prepared: Extract<PreparedSession, { kind: "ready" }>, input: SaveInput = {}): Promise<SaveResult> {
      const { record, book, actualSec } = prepared;

      const base: CompleteSessionInput = {
        id: record.sessionId,
        book_id: record.bookId,
        planned_duration_sec: record.plannedSec,
        actual_duration_sec: actualSec,
        started_at_local: record.startedAtLocal,
        session_status: "COMPLETED",
      };

      let complete: CompleteSessionInput;
      if (book.format_type === "PHYSICAL") {
        const total = book.total_pages ?? 0;
        const page = input.page;
        if (page === undefined || !Number.isInteger(page) || page < 1 || page > total) {
          throw new InvalidPageError(total);
        }
        // Menos de 5 minutos solo vale si el lector termino el libro: ultima pagina.
        if (prepared.short && page !== total) return { kind: "discarded" };
        complete = { ...base, current_page: page };
      } else {
        complete = { ...base, ...(await epubFields(prepared, input)) };
      }

      let result;
      try {
        result = await deps.sessions.completeSession(complete, { acceptInactiveBook: true });
      } catch (error) {
        if (error instanceof KomiLocalError && error.code === "duration_out_of_range") {
          return { kind: "discarded" };
        }
        throw error;
      }

      const streak = await updateStreak();
      const before = book.progress_percentage;
      return {
        kind: "saved",
        session: result.session,
        book: result.book,
        before,
        solarBonus: result.session.granted_solar_bonus,
        bloomed: result.created && before < 100 && result.book.progress_percentage >= 100,
        streak,
        created: result.created,
      };
    },
  };
}

export type PostReadingService = ReturnType<typeof createPostReadingService>;
