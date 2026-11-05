// Dependencias de la app en un solo lugar: la interfaz las recibe por props y las pruebas
// pasan una base de datos y un cliente HTTP falsos.

import type { KomiDatabase } from "../data/local_db/dexieDatabase";
import { getDatabase } from "../data/local_db/dexieDatabase";
import { createLocalBookRepository, systemClock } from "../data/local_db/localBookRepository";
import { createLocalEpubRepository } from "../data/local_db/localEpubRepository";
import { createLocalMetaRepository } from "../data/local_db/localMetaRepository";
import { createLocalProfileRepository } from "../data/local_db/localProfileRepository";
import { createLocalReflectionRepository } from "../data/local_db/localReflectionRepository";
import { getApiClient, type ApiClient } from "../data/network/apiClient";
import { createOnboardingSync } from "../data/network/onboardingSync";
import { createSyncService } from "../data/network/syncService";
import { createEpubService, type EpubService } from "../services/epubService";
import { createOnboardingService } from "../services/onboardingService";
import { createPlantBookService } from "../services/plantBookService";

export interface AppOptions {
  db?: KomiDatabase;
  api?: ApiClient;
  /** Solo para pruebas: motor de epubjs propio. */
  epub?: Pick<EpubService, "inspect" | "generateLocations">;
  /** Aviso en consola si el servidor responde otra meta (solo desarrollo). */
  warnOnMismatch?: boolean;
}

export function createAppDeps(options: AppOptions = {}) {
  const db = options.db ?? getDatabase();
  const api = options.api ?? getApiClient();
  const profiles = createLocalProfileRepository(db);
  const books = createLocalBookRepository(db, systemClock);
  const epubFiles = createLocalEpubRepository(db, systemClock);
  const onboardingSync = createOnboardingSync({
    db,
    api,
    profiles,
    warnOnMismatch: options.warnOnMismatch ?? false,
  });
  return {
    profiles,
    meta: createLocalMetaRepository(db),
    books,
    epubFiles,
    reflections: createLocalReflectionRepository(db, systemClock),
    onboarding: createOnboardingService(db, systemClock, profiles),
    /** Cola del onboarding (POST /profile/onboarding/). */
    sync: onboardingSync,
    /** Libros y sesiones pendientes (POST /profile/sync/). */
    syncService: createSyncService({
      db,
      api,
      clock: systemClock,
      // Un 401 puede ser un onboarding aun en cola: se confirma y se reintenta una vez.
      recoverUnauthorized: async () => (await onboardingSync.flush()).status === "synced",
    }),
    plant: createPlantBookService({
      epub: options.epub ?? createEpubService(),
      epubFiles,
      books,
    }),
  };
}

export type AppDeps = ReturnType<typeof createAppDeps>;
