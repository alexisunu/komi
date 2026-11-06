// Dependencias de la app en un solo lugar: la interfaz las recibe por props y las pruebas
// pasan una base de datos y un cliente HTTP falsos.

import type { KomiDatabase } from "../data/local_db/dexieDatabase";
import { getDatabase } from "../data/local_db/dexieDatabase";
import { createLocalBookRepository, systemClock } from "../data/local_db/localBookRepository";
import { createLocalEpubRepository } from "../data/local_db/localEpubRepository";
import { createLocalMetaRepository, META_KEYS } from "../data/local_db/localMetaRepository";
import { createLocalProfileRepository } from "../data/local_db/localProfileRepository";
import { createLocalReflectionRepository } from "../data/local_db/localReflectionRepository";
import { createLocalSessionRepository } from "../data/local_db/localSessionRepository";
import { getApiClient, type ApiClient } from "../data/network/apiClient";
import { createCompanionClient } from "../data/network/companionClient";
import { createOnboardingSync } from "../data/network/onboardingSync";
import { createSyncService } from "../data/network/syncService";
import { createEpubReaderService, type EpubReaderService } from "../services/epubReaderService";
import { createEpubService, type EpubService } from "../services/epubService";
import { parseReadingProgress, type ReadingProgress } from "../services/readingTracker";
import { parseActiveSession } from "../services/focusSessionMachine";
import {
  createFocusVisibilityService,
  type FocusDocument,
  type FocusWindow,
} from "../services/focusVisibilityService";
import { createWakeLockService, type WakeLockService } from "../services/wakeLockService";
import { reloadGate, type ReloadGate } from "../pwa/reloadGate";
import { createOnboardingService } from "../services/onboardingService";
import { createPlantBookService } from "../services/plantBookService";
import { createCompanionService } from "../services/companionService";
import { createPostReadingService } from "../services/postReadingService";

export interface AppOptions {
  db?: KomiDatabase;
  api?: ApiClient;
  /** Solo para pruebas: motor de epubjs propio. */
  epub?: Pick<EpubService, "inspect" | "generateLocations"> & Partial<Pick<EpubService, "percentageAt">>;
  /** Solo para pruebas: lector EPUB propio (en jsdom epubjs no puede dibujar paginas). */
  epubReader?: EpubReaderService;
  /** Solo para pruebas: reloj y Page Visibility del temporizador (el almacen y el guardado son reales). */
  focusEnv?: { now: () => number; doc: FocusDocument; win: FocusWindow };
  /** Solo para pruebas: pantalla encendida y puerta de recarga propios. */
  wakeLock?: WakeLockService;
  gate?: ReloadGate;
  /** Aviso en consola si el servidor responde otra meta (solo desarrollo). */
  warnOnMismatch?: boolean;
}

export function createAppDeps(options: AppOptions = {}) {
  const db = options.db ?? getDatabase();
  const api = options.api ?? getApiClient();
  const profiles = createLocalProfileRepository(db);
  const meta = createLocalMetaRepository(db);
  const sessions = createLocalSessionRepository(db, systemClock);
  const books = createLocalBookRepository(db, systemClock);
  const epubFiles = createLocalEpubRepository(db, systemClock);
  const reflections = createLocalReflectionRepository(db, systemClock);
  const onboardingSync = createOnboardingSync({
    db,
    api,
    profiles,
    warnOnMismatch: options.warnOnMismatch ?? false,
  });
  const syncService = createSyncService({
    db,
    api,
    clock: systemClock,
    // Un 401 puede ser un onboarding aun en cola: se confirma y se reintenta una vez.
    recoverUnauthorized: async () => (await onboardingSync.flush()).status === "synced",
  });
  const realEpub = createEpubService();
  const epub = options.epub ?? realEpub;
  const focusNow = options.focusEnv?.now ?? (() => Date.now());
  const focus = createFocusVisibilityService({
    now: focusNow,
    doc: options.focusEnv?.doc ?? document,
    win: options.focusEnv?.win ?? window,
    store: {
      load: async () => parseActiveSession(await meta.get(META_KEYS.activeSession)),
      save: (session) => meta.set(META_KEYS.activeSession, JSON.stringify(session)),
      // La sesion termino (guardada, cancelada o descartada): tambien su avance de lectura.
      clear: async () => {
        await meta.remove(META_KEYS.activeSession);
        await meta.remove(META_KEYS.activeSessionProgress);
      },
    },
    // Gracia vencida: se guarda invalida (no toca el progreso) y se sube en cuanto se pueda.
    saveInvalidated: async (session, actualSec) => {
      await sessions.completeSession({
        id: session.sessionId,
        book_id: session.bookId,
        planned_duration_sec: session.plannedSec,
        actual_duration_sec: actualSec,
        started_at_local: session.startedAtLocal,
        session_status: "INVALIDATED_GRACE_EXPIRED",
      });
      void syncService.flush().catch(() => {});
    },
  });
  return {
    profiles,
    meta,
    sessions,
    /** Temporizador de lectura (RF-02): gracia de 15 s y registro `active_session`. */
    focus,
    /** Lector EPUB: epubjs, archivo del dispositivo y avance de la sesion (`active_session_progress`). */
    epubReader: {
      reader: options.epubReader ?? createEpubReaderService(realEpub),
      files: epubFiles,
      progress: {
        load: async () => parseReadingProgress(await meta.get(META_KEYS.activeSessionProgress)),
        save: (progress: ReadingProgress) =>
          meta.set(META_KEYS.activeSessionProgress, JSON.stringify(progress)),
      },
      now: focusNow,
    },
    /** Cierre de la sesion (CU-04): guarda sesion y avance, recalcula la racha. */
    postReading: createPostReadingService({
      loadActiveSession: async () => parseActiveSession(await meta.get(META_KEYS.activeSession)),
      loadProgress: async () => parseReadingProgress(await meta.get(META_KEYS.activeSessionProgress)),
      books,
      sessions,
      epubFiles,
      epub: { percentageAt: options.epub?.percentageAt ?? realEpub.percentageAt },
      meta,
      now: focusNow,
    }),
    /** Charla con Komi (CU-05): exige la sesion en el servidor; guarda la semilla en `reflections`. */
    companion: createCompanionService({
      client: createCompanionClient(api),
      sync: syncService,
      reflections,
    }),
    /** Pantalla encendida durante la sesion (SRS 19.12). */
    wakeLock: options.wakeLock ?? createWakeLockService(navigator, document),
    /** Puerta de recarga del Service Worker: se bloquea mientras dura la sesion. */
    gate: options.gate ?? reloadGate,
    books,
    epubFiles,
    reflections,
    onboarding: createOnboardingService(db, systemClock, profiles),
    /** Cola del onboarding (POST /profile/onboarding/). */
    sync: onboardingSync,
    /** Libros y sesiones pendientes (POST /profile/sync/). */
    syncService,
    plant: createPlantBookService({
      epub,
      epubFiles,
      books,
    }),
  };
}

export type AppDeps = ReturnType<typeof createAppDeps>;
