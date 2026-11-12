// Tabla `meta` (clave y valor): ajustes y colas pequenas que no merecen tabla propia. No cambia el
// esquema de Dexie.

import { getDatabase, type KomiDatabase } from "./dexieDatabase";
import { guardStorage } from "./storageGuard";
import type { MetaEntry } from "./types";

export const META_KEYS = {
  /** JSON con { profile_id, answers } del POST /profile/onboarding/ que aun no se confirma. */
  onboardingPending: "onboarding_pending",
  /** JSON con el ultimo rechazo permanente (4xx) del POST de onboarding. */
  onboardingError: "onboarding_sync_error",
  /** Racha actual a mostrar. La escribe la sincronizacion (valor del servidor) o la racha local (localStreak). */
  streakCurrent: "streak_current",
  /** JSON { [book_id]: codigo } de libros con rechazo permanente del servidor: no se reenvian. */
  syncBookRejections: "sync_book_rejections",
  /** JSON de la sesion de lectura en curso (focusSessionMachine.ActiveSession). Se borra al terminar. */
  activeSession: "active_session",
  /** Id del libro que el lector eligio con "Leer este libro". El Dashboard lo usa si sigue siendo valido. */
  activeBookId: "active_book_id",
  /** JSON del avance de la sesion EPUB en curso (CFI, porcentaje, extracto). Clave aparte del latido. */
  activeSessionProgress: "active_session_progress",
  /** Tamano de letra del lector EPUB (16, 18, 20 o 22). */
  readerFontSize: "reader_font_size",
  /** Ultima eleccion del selector del Dashboard: "TIMER" o "FREE". Solo local, no se sincroniza. */
  timerMode: "timer_mode",
} as const;

/**
 * Posicion de lectura de un libro EPUB: JSON `{ cfi, updatedAt }`, una clave por libro. Es aparte
 * del avance validado (`books.last_epub_cfi` y el porcentaje, que solo mueve una sesion valida):
 * guarda donde se quedo el lector aunque la sesion se invalide o se abandone.
 */
export function readerPositionKey(bookId: string): string {
  return `reader_position:${bookId}`;
}

export function createLocalMetaRepository(db: KomiDatabase = getDatabase()) {
  return {
    async get(key: string): Promise<MetaEntry["value"] | undefined> {
      return guardStorage(async () => (await db.meta.get(key))?.value);
    },

    async set(key: string, value: MetaEntry["value"]): Promise<void> {
      await guardStorage(() => db.meta.put({ key, value }));
    },

    async remove(key: string): Promise<void> {
      await guardStorage(() => db.meta.delete(key));
    },

    /** Racha para el badge: entero de cero o mas; sin dato o dato invalido, 0. */
    async getStreakCurrent(): Promise<number> {
      const value = await guardStorage(async () => (await db.meta.get(META_KEYS.streakCurrent))?.value);
      return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 0;
    },
  };
}

export type LocalMetaRepository = ReturnType<typeof createLocalMetaRepository>;
