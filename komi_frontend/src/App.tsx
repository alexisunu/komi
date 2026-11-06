// Enrutador por estado (SRS 18, punto 15): cargando, onboarding o app principal. Sin react-router.

import { useCallback, useEffect, useMemo, useState } from "react";
import { BottomNavZen, type NavId } from "./core/components/BottomNavZen";
import { ThemeProvider } from "./core/theme/ThemeContext";
import type { ThemeId } from "./core/theme/colorTokens";
import { createAppDeps, type AppDeps, type AppOptions } from "./app/appDeps";
import { loadInitialState, type InitialState } from "./app/loadInitialState";
import { watchOnboardingSync } from "./data/network/onboardingSync";
import { watchSync } from "./data/network/syncService";
import { requestPersistentStorage } from "./pwa/persistStorage";
import type { LocalBook, LocalProfile } from "./data/local_db/types";
import { META_KEYS } from "./data/local_db/localMetaRepository";
import { canReadBook, resolveActiveBook } from "./features/dashboard/activeBook";
import { DashboardScreen } from "./features/dashboard/DashboardScreen";
import { GracePeriodBanner } from "./features/focus_reader/GracePeriodBanner";
import { PhysicalTimerScreen } from "./features/focus_reader/PhysicalTimerScreen";
import { SessionEndedScreen } from "./features/focus_reader/SessionEndedScreen";
import { useFocusSession } from "./features/focus_reader/useFocusSession";
import { MyGardenScreen } from "./features/garden_library/MyGardenScreen";
import { useLibrary } from "./features/garden_library/useLibrary";
import { OnboardingScreen } from "./features/onboarding/OnboardingScreen";
import { ZenPrimaryButton } from "./core/components/ZenPrimaryButton";
import { StatsScreen } from "./features/stats/StatsScreen";
import type { CompleteOnboardingResult } from "./services/onboardingService";
import "./App.css";

export interface AppProps {
  /** Solo para pruebas: base de datos y cliente HTTP propios. */
  options?: AppOptions;
}

export function App({ options }: AppProps) {
  const deps = useMemo(
    () => createAppDeps({ warnOnMismatch: import.meta.env.DEV, ...options }),
    [options],
  );
  const [initial, setInitial] = useState<InitialState | null>(null);

  // Pide almacenamiento persistente al arrancar y deja el resultado registrado.
  useEffect(() => {
    void requestPersistentStorage({ storage: navigator.storage, meta: deps.meta });
  }, [deps]);

  useEffect(() => {
    let cancelled = false;
    void loadInitialState(deps).then((state) => {
      if (!cancelled) setInitial(state);
    });
    return () => {
      cancelled = true;
    };
  }, [deps]);

  if (!initial) {
    return (
      <div className="app-loading" role="status">
        Cargando
      </div>
    );
  }
  return <Session deps={deps} initial={initial} />;
}

interface SessionProps {
  deps: AppDeps;
  initial: InitialState;
}

function Session({ deps, initial }: SessionProps) {
  const [profile, setProfile] = useState<LocalProfile | null>(
    initial.status === "ready" ? initial.profile : null,
  );
  const [view, setView] = useState<"onboarding" | "main">(initial.status === "ready" ? "main" : "onboarding");
  const [nav, setNav] = useState<NavId>("lectura");

  const refreshProfile = useCallback(() => {
    deps.profiles
      .getProfile()
      .then((next) => next && setProfile(next))
      .catch(() => {
        // Se conserva el perfil en memoria; Dexie sigue siendo la fuente.
      });
  }, [deps]);

  // Reintenta la cola de onboarding al abrir y al volver la red (Safari no tiene Background Sync).
  useEffect(
    () =>
      watchOnboardingSync(deps.sync, window, (result) => {
        if (result.profileUpdated) refreshProfile();
      }),
    [deps, refreshProfile],
  );

  // Sube libros y sesiones pendientes al abrir y cada vez que vuelve la red.
  useEffect(() => watchSync(deps.syncService, window), [deps]);

  const persistTheme = useCallback(
    (mode: ThemeId) => {
      deps.profiles.updateProfile({ theme_mode: mode }).catch(() => {
        // El tema ya cambio en pantalla; solo no quedo guardado para la proxima vez.
      });
    },
    [deps],
  );

  const onProfileCreated = useCallback(
    (result: CompleteOnboardingResult) => {
      setProfile(result.profile);
      // El plan ya esta en Dexie: se pasa a la pantalla siguiente y la red va en segundo plano.
      deps.sync
        .flush()
        .then((flushed) => {
          if (flushed.profileUpdated) refreshProfile();
        })
        .catch(() => {});
    },
    [deps, refreshProfile],
  );

  return (
    <ThemeProvider
      storedMode={profile?.theme_mode ?? null}
      preconfigureTsukimi={profile?.preconfigure_tsukimi ?? null}
      onModeChange={persistTheme}
    >
      {view === "onboarding" ? (
        <>
          {initial.status === "onboarding" && initial.storageWarning && (
            <p className="app-notice" role="alert">
              {initial.storageWarning}
            </p>
          )}
          <OnboardingScreen
            service={deps.onboarding}
            onProfileCreated={onProfileCreated}
            onFinish={() => setView("main")}
          />
        </>
      ) : (
        <MainApp
          deps={deps}
          nav={nav}
          onNav={setNav}
          profile={profile}
          initial={initial.status === "ready" ? initial : null}
        />
      )}
    </ThemeProvider>
  );
}

interface MainAppProps {
  deps: AppDeps;
  nav: NavId;
  onNav: (id: NavId) => void;
  profile: LocalProfile | null;
  initial: Extract<InitialState, { status: "ready" }> | null;
}

function MainApp({ deps, nav, onNav, profile, initial }: MainAppProps) {
  const library = useLibrary(deps, initial?.books ?? []);
  const { reload } = library;
  // Libro elegido con "Leer este libro"; undefined mientras se lee de meta (el boton espera).
  const [chosenId, setChosenId] = useState<string | null | undefined>(undefined);
  const activeBook = resolveActiveBook(library.books, chosenId);
  const focus = useFocusSession(deps.focus, deps.gate);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    deps.meta
      .get(META_KEYS.activeBookId)
      .then((value) => alive && setChosenId(typeof value === "string" ? value : null))
      .catch(() => alive && setChosenId(null));
    return () => {
      alive = false;
    };
  }, [deps]);

  // Al cambiar de pantalla se relee la biblioteca (por ejemplo, un .epub que el sistema purgo).
  useEffect(() => {
    void reload();
  }, [nav, reload]);

  // Escritura inmediata (SRS 11.4): tras un cambio se intenta subir, sin esperar ni bloquear.
  const pushChanges = useCallback(() => {
    deps.syncService.flush().catch(() => {});
  }, [deps]);

  const onPlanted = useCallback(() => {
    void reload();
    pushChanges();
  }, [reload, pushChanges]);

  const onSetStatus = useCallback(
    async (book: LocalBook, status: "ACTIVE" | "FALLOW") => {
      await deps.books.updateBook(book.id, { status });
      await reload();
      pushChanges();
    },
    [deps, reload, pushChanges],
  );

  const onReimport = useCallback(
    async (book: LocalBook, file: File) => {
      await deps.plant.reimportEpub(book.id, file);
      await reload();
    },
    [deps, reload],
  );

  const onRead = useCallback(
    async (book: LocalBook) => {
      await deps.meta.set(META_KEYS.activeBookId, book.id);
      setChosenId(book.id);
    },
    [deps],
  );

  const snapshot = focus.snapshot;
  const canStart =
    chosenId !== undefined &&
    snapshot === null &&
    !starting &&
    activeBook !== null &&
    activeBook.format_type === "PHYSICAL" &&
    canReadBook(activeBook);

  const startReading = async (minutes: number) => {
    if (!activeBook || !canReadBook(activeBook)) return;
    setStarting(true);
    setStartError(null);
    try {
      await focus.start({
        sessionId: crypto.randomUUID(),
        bookId: activeBook.id,
        plannedSec: minutes * 60,
      });
    } catch {
      setStartError("No se pudo iniciar la sesión. Intenta de nuevo.");
    } finally {
      setStarting(false);
    }
  };

  // Sesion en curso: sin navegacion inferior (CU-03, paso 4).
  if (snapshot && (snapshot.phase === "running" || snapshot.phase === "grace")) {
    return (
      <div className="app-shell">
        <div className="app-shell__screen">
          <PhysicalTimerScreen
            book={library.books.find((book) => book.id === snapshot.bookId) ?? null}
            snapshot={snapshot}
            wakeLock={deps.wakeLock}
            peekEarlyFinish={focus.peekEarlyFinish}
            onAcceptEarly={focus.acceptEarlyFinish}
            onCancel={focus.leave}
          />
        </div>
      </div>
    );
  }

  // Pantalla provisional (SRS 19.15): el bloque 6 la sustituye por PostReadingSheet.
  if (snapshot && (snapshot.phase === "completed" || snapshot.phase === "early")) {
    return (
      <div className="app-shell">
        <div className="app-shell__screen">
          <SessionEndedScreen
            book={library.books.find((book) => book.id === snapshot.bookId) ?? null}
            minutesRead={Math.floor((snapshot.actualSec ?? 0) / 60)}
            onLeave={async () => {
              try {
                await focus.leave();
              } finally {
                onNav("jardin");
              }
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="app-shell__screen">
        {snapshot?.phase === "invalidated" && (
          <div className="session-notice" data-testid="session-invalidated">
            <GracePeriodBanner variant="invalidated" />
            <ZenPrimaryButton variant="secondary" onClick={() => void focus.leave()}>
              Entendido
            </ZenPrimaryButton>
          </div>
        )}
        {startError && (
          <p className="app-notice" role="alert">
            {startError}
          </p>
        )}
        {nav === "lectura" && (
          <DashboardScreen
            key={profile?.daily_goal_minutes}
            streakDays={initial?.streakDays ?? 0}
            book={activeBook}
            dailyGoalMinutes={profile?.daily_goal_minutes ?? 15}
            canStart={canStart}
            onStart={(minutes) => void startReading(minutes)}
          />
        )}
        {nav === "jardin" && (
          <MyGardenScreen
            books={library.books}
            missingFiles={library.missingFiles}
            activeBookId={activeBook?.id ?? null}
            plant={deps.plant}
            onPlanted={onPlanted}
            onSetStatus={onSetStatus}
            onReimport={onReimport}
            onRead={onRead}
          />
        )}
        {nav === "estadisticas" && <StatsScreen />}
      </div>
      <div data-block="nav">
        <BottomNavZen active={nav} onSelect={onNav} />
      </div>
    </div>
  );
}
