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
  /** Racha actual. La escribe la sincronizacion (Fase 4); el cliente no la calcula (SRS 17). */
  streakCurrent: "streak_current",
} as const;

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
