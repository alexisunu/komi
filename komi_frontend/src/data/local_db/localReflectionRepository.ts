// Charlas con Komi guardadas en el dispositivo: la "semilla del dia" de cada libro (SRS 10.3) se lee
// de aqui, sin red. El servidor es la fuente de verdad; esta tabla es una copia para la interfaz.

import { getDatabase, type KomiDatabase } from "./dexieDatabase";
import { systemClock, type LocalClock } from "./localBookRepository";
import { guardStorage } from "./storageGuard";
import type { LocalReflection } from "./types";

export interface ReflectionUpdate {
  chat_id: string;
  session_id: string;
  book_id: string;
  turn_count: number;
  is_closed: boolean;
  key_takeaway?: string | null;
}

export function createLocalReflectionRepository(
  db: KomiDatabase = getDatabase(),
  clock: LocalClock = systemClock,
) {
  return {
    /**
     * Crea o actualiza la copia local. Es monotona, como la charla en el servidor: `turn_count` no
     * baja, una charla cerrada no se reabre y una semilla ya guardada no se borra con un null.
     */
    upsert(update: ReflectionUpdate): Promise<LocalReflection> {
      return guardStorage(() =>
        db.transaction("rw", db.reflections, async () => {
          const current = await db.reflections.get(update.chat_id);
          const takeaway = update.key_takeaway?.trim() ? update.key_takeaway.trim() : null;
          const next: LocalReflection = {
            chat_id: update.chat_id,
            session_id: update.session_id,
            book_id: update.book_id,
            turn_count: Math.max(current?.turn_count ?? 0, update.turn_count),
            is_closed: (current?.is_closed ?? false) || update.is_closed,
            key_takeaway: takeaway ?? current?.key_takeaway ?? null,
            updated_at: clock.now().toISOString(),
          };
          const same =
            current &&
            current.turn_count === next.turn_count &&
            current.is_closed === next.is_closed &&
            current.key_takeaway === next.key_takeaway;
          if (same) return current;
          await db.reflections.put(next);
          return next;
        }),
      );
    },

    get(chatId: string): Promise<LocalReflection | undefined> {
      return guardStorage(() => db.reflections.get(chatId));
    },

    getBySession(sessionId: string): Promise<LocalReflection | undefined> {
      return guardStorage(() => db.reflections.where("session_id").equals(sessionId).first());
    },

    /** Semillas del dia de un libro: charlas cerradas con frase, de la mas reciente a la mas antigua. */
    async listSeedsForBook(bookId: string): Promise<LocalReflection[]> {
      const rows = await guardStorage(() => db.reflections.where("book_id").equals(bookId).toArray());
      return rows
        .filter((row) => row.is_closed && row.key_takeaway !== null)
        .sort((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0));
    },

    /** Charlas completadas (cerradas), para el contador de estadisticas. */
    async countClosed(): Promise<number> {
      const rows = await guardStorage(() => db.reflections.toArray());
      return rows.filter((row) => row.is_closed).length;
    },
  };
}

export type LocalReflectionRepository = ReturnType<typeof createLocalReflectionRepository>;
