// Dependencias de la app en un solo lugar: la interfaz las recibe por props y las pruebas
// pasan una base de datos y un cliente HTTP falsos.

import type { KomiDatabase } from "../data/local_db/dexieDatabase";
import { getDatabase } from "../data/local_db/dexieDatabase";
import { createLocalBookRepository, systemClock } from "../data/local_db/localBookRepository";
import { createLocalMetaRepository } from "../data/local_db/localMetaRepository";
import { createLocalProfileRepository } from "../data/local_db/localProfileRepository";
import { getApiClient, type ApiClient } from "../data/network/apiClient";
import { createOnboardingSync } from "../data/network/onboardingSync";
import { createOnboardingService } from "../services/onboardingService";

export interface AppOptions {
  db?: KomiDatabase;
  api?: ApiClient;
  /** Aviso en consola si el servidor responde otra meta (solo desarrollo). */
  warnOnMismatch?: boolean;
}

export function createAppDeps(options: AppOptions = {}) {
  const db = options.db ?? getDatabase();
  const profiles = createLocalProfileRepository(db);
  return {
    profiles,
    meta: createLocalMetaRepository(db),
    books: createLocalBookRepository(db, systemClock),
    onboarding: createOnboardingService(db, systemClock, profiles),
    sync: createOnboardingSync({
      db,
      api: options.api ?? getApiClient(),
      profiles,
      warnOnMismatch: options.warnOnMismatch ?? false,
    }),
  };
}

export type AppDeps = ReturnType<typeof createAppDeps>;
