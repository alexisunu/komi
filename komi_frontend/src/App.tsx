// Enrutador por estado (SRS 18, punto 15): cargando, onboarding o app principal. Sin react-router.

import { useCallback, useEffect, useMemo, useState } from "react";
import { BottomNavZen, type NavId } from "./core/components/BottomNavZen";
import { ThemeProvider } from "./core/theme/ThemeContext";
import type { ThemeId } from "./core/theme/colorTokens";
import { createAppDeps, type AppDeps, type AppOptions } from "./app/appDeps";
import { loadInitialState, type InitialState } from "./app/loadInitialState";
import { watchOnboardingSync } from "./data/network/onboardingSync";
import { requestPersistentStorage } from "./pwa/persistStorage";
import type { LocalProfile } from "./data/local_db/types";
import { DashboardScreen } from "./features/dashboard/DashboardScreen";
import { MyGardenScreen } from "./features/garden_library/MyGardenScreen";
import { OnboardingScreen } from "./features/onboarding/OnboardingScreen";
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
  nav: NavId;
  onNav: (id: NavId) => void;
  profile: LocalProfile | null;
  initial: Extract<InitialState, { status: "ready" }> | null;
}

function MainApp({ nav, onNav, profile, initial }: MainAppProps) {
  return (
    <div className="app-shell">
      <div className="app-shell__screen">
        {nav === "lectura" && (
          <DashboardScreen
            key={profile?.daily_goal_minutes}
            streakDays={initial?.streakDays ?? 0}
            book={initial?.book ?? null}
            dailyGoalMinutes={profile?.daily_goal_minutes ?? 15}
          />
        )}
        {nav === "jardin" && <MyGardenScreen />}
        {nav === "estadisticas" && <StatsScreen />}
      </div>
      <div data-block="nav">
        <BottomNavZen active={nav} onSelect={onNav} />
      </div>
    </div>
  );
}
