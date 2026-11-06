import { getDatabase, type KomiDatabase } from "./dexieDatabase";
import { BookNotFoundError } from "./errors";
import { fromHundredths } from "./progressMath";
import { systemClock, type LocalClock } from "./localBookRepository";
import {
  evaluateSession,
  validateSessionInput,
  type CompleteSessionInput,
  type EvaluateOptions,
} from "./sessionRules";
import { guardStorage } from "./storageGuard";
import type { LocalBook, LocalSession } from "./types";

export interface CompleteSessionResult {
  session: LocalSession;
  book: LocalBook;
  /** Falso si la sesion ya existia (mismo UUID): no se escribio nada. */
  created: boolean;
}

export function createLocalSessionRepository(
  db: KomiDatabase = getDatabase(),
  clock: LocalClock = systemClock,
) {
  return {
    /**
     * Guarda la sesion Y actualiza el avance del libro en UNA sola transaccion: o se guardan
     * ambos o ninguno. Reglas (espejo del servidor):
     *  - Idempotente por UUID: una sesion existente nunca se sobrescribe ni toca el libro.
     *  - Progreso monotonico: nunca baja. `current_page` y `last_epub_cfi` solo cambian si la
     *    lectura no retrocedio.
     *  - `updated_at` del libro solo cambia si algo cambio de verdad.
     *  - Una sesion invalidada (gracia vencida) se guarda sin tocar el libro.
     *  - `acceptInactiveBook`: una lectura valida sobre un libro en barbecho o florecido se guarda
     *    igual (la sesion es del lector y no se pierde), sin volver a florecer ni bajar el avance.
     */
    async completeSession(
      input: CompleteSessionInput,
      options: EvaluateOptions = {},
    ): Promise<CompleteSessionResult> {
      validateSessionInput(input);

      return await guardStorage(() =>
        db.transaction("rw", db.books, db.sessions, async () => {
          const existing = await db.sessions.get(input.id);
          if (existing) {
            const owner = await db.books.get(existing.book_id);
            if (!owner) throw new BookNotFoundError(existing.book_id);
            return { session: existing, book: owner, created: false };
          }

          const book = await db.books.get(input.book_id);
          if (!book) throw new BookNotFoundError(input.book_id);

          const outcome = evaluateSession(book, input, options);
          let nextBook = book;

          if (outcome.valid) {
            const newProgress = fromHundredths(outcome.newProgressHundredths);
            const cfi =
              outcome.updateCfi && input.last_epub_cfi !== undefined
                ? input.last_epub_cfi
                : book.last_epub_cfi;
            const changed =
              newProgress !== book.progress_percentage ||
              outcome.newPage !== book.current_page ||
              cfi !== book.last_epub_cfi ||
              outcome.justBloomed;

            if (changed) {
              const stamp = clock.now().toISOString();
              nextBook = {
                ...book,
                progress_percentage: newProgress,
                current_page: outcome.newPage,
                last_epub_cfi: cfi,
                status: outcome.justBloomed ? "BLOOMED" : book.status,
                completed_at: outcome.justBloomed ? stamp : book.completed_at,
                updated_at: stamp,
                pending_sync: 1,
              };
              await db.books.put(nextBook);
            }
          }

          const excerpt = input.extracted_epub_excerpt;
          const keepExcerpt = outcome.valid && book.format_type === "EPUB" && !!excerpt;
          const session: LocalSession = {
            id: input.id,
            book_id: input.book_id,
            planned_duration_sec: input.planned_duration_sec,
            actual_duration_sec: input.actual_duration_sec,
            started_at_local: input.started_at_local,
            session_status: outcome.status,
            current_page: outcome.reportedPage,
            progress_percentage: outcome.reportedProgress,
            last_epub_cfi: outcome.valid && book.format_type === "EPUB" ? (input.last_epub_cfi ?? null) : null,
            extracted_epub_excerpt: keepExcerpt ? (excerpt ?? null) : null,
            progress_delta: fromHundredths(outcome.deltaHundredths),
            granted_solar_bonus: outcome.grantedSolarBonus,
            pending_sync: 1,
            sync_rejection: null,
          };
          await db.sessions.add(session);
          return { session, book: nextBook, created: true };
        }),
      );
    },

    getSession(id: string): Promise<LocalSession | undefined> {
      return guardStorage(() => db.sessions.get(id));
    },

    /** Sesiones de un libro en orden cronologico (indice compuesto). */
    listSessionsForBook(bookId: string): Promise<LocalSession[]> {
      return guardStorage(() =>
        db.sessions
          .where("[book_id+started_at_local]")
          .between([bookId, ""], [bookId, "￿"])
          .toArray(),
      );
    },

    /** Sesiones por rango de hora local (estadisticas semanales y rachas). */
    listSessionsBetween(fromLocal: string, toLocal: string): Promise<LocalSession[]> {
      return guardStorage(() =>
        db.sessions.where("started_at_local").between(fromLocal, toLocal, true, true).toArray(),
      );
    },

    /** Sesiones sin enviar, en orden cronologico, para armar el lote de /profile/sync/. */
    listPendingSessions(): Promise<LocalSession[]> {
      return guardStorage(async () => {
        const pending = (await db.sessions.where("pending_sync").equals(1).toArray()).filter(
          (session) => session.sync_rejection === null,
        );
        return pending.sort((a, b) =>
          a.started_at_local < b.started_at_local ? -1 : a.started_at_local > b.started_at_local ? 1 : 0,
        );
      });
    },

    /**
     * Rechazo PERMANENTE del servidor: la sesion no se borra (es del lector), pero sale de la cola
     * de envio y queda marcada con el codigo, para excluirla de la racha local. Anula el extracto.
     */
    markSessionsRejected(entries: ReadonlyArray<{ id: string; code: string }>): Promise<void> {
      return guardStorage(() =>
        db.transaction("rw", db.sessions, async () => {
          for (const { id, code } of entries) {
            const session = await db.sessions.get(id);
            if (session && session.sync_rejection !== code) {
              await db.sessions.put({
                ...session,
                pending_sync: 0,
                sync_rejection: code,
                extracted_epub_excerpt: null,
              });
            }
          }
        }),
      );
    },

    /**
     * Tras un sync exitoso: limpia la marca de pendiente y ANULA el extracto del EPUB, porque el
     * servidor ya lo tiene y el texto ocupa espacio local. Repetirlo no cambia nada.
     */
    markSessionsSynced(ids: readonly string[]): Promise<void> {
      return guardStorage(() =>
        db.transaction("rw", db.sessions, async () => {
          for (const id of ids) {
            const session = await db.sessions.get(id);
            if (session && (session.pending_sync === 1 || session.extracted_epub_excerpt !== null)) {
              await db.sessions.put({ ...session, pending_sync: 0, extracted_epub_excerpt: null });
            }
          }
        }),
      );
    },
  };
}

export type LocalSessionRepository = ReturnType<typeof createLocalSessionRepository>;
