// Enrutador por estado (SRS 18, punto 15): cargando, onboarding o app principal. Sin react-router.

import { useCallback, useEffect, useMemo, useState } from "react";
import { BottomNavZen, type NavId } from "./core/components/BottomNavZen";
import { PreparationProgress } from "./core/components/PreparationProgress";
import { ThemeProvider, useTheme } from "./core/theme/ThemeContext";
import type { ThemeId } from "./core/theme/colorTokens";
import { createAppDeps, type AppDeps, type AppOptions } from "./app/appDeps";
import { loadInitialState, type InitialState } from "./app/loadInitialState";
import { watchOnboardingSync } from "./data/network/onboardingSync";
import { watchSync } from "./data/network/syncService";
import { watchWake } from "./data/network/wakeService";
import { useWakeState } from "./app/useWakeState";
import { requestPersistentStorage } from "./pwa/persistStorage";
import type { LocalBook, LocalProfile } from "./data/local_db/types";
import { META_KEYS } from "./data/local_db/localMetaRepository";
import { CompanionChatScreen } from "./features/ai_companion/CompanionChatScreen";
import { canReadBook, resolveActiveBook } from "./features/dashboard/activeBook";
import { DashboardScreen } from "./features/dashboard/DashboardScreen";
import { EpubReaderScreen } from "./features/focus_reader/EpubReaderScreen";
import { PhysicalTimerScreen } from "./features/focus_reader/PhysicalTimerScreen";
import { PostReadingSheet, type SavedReading } from "./features/focus_reader/PostReadingSheet";
import { useFocusSession } from "./features/focus_reader/useFocusSession";
import { MyGardenScreen } from "./features/garden_library/MyGardenScreen";
import { useLibrary } from "./features/garden_library/useLibrary";
import { OnboardingScreen } from "./features/onboarding/OnboardingScreen";
import { InvalidatedSessionSheet } from "./features/focus_reader/InvalidatedSessionSheet";
import { StatsScreen } from "./features/stats/StatsScreen";
import type { TimerType } from "./services/focusSessionMachine";
import type { CompleteOnboardingResult } from "./services/onboardingService";
import { DEFAULT_FONT_SIZE, isFontSize, type ReaderFontSize } from "./services/readerTheme";
import { isTimerType } from "./features/dashboard/timerSelection";
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
  // Cambia al recuperar los datos: la sesion se vuelve a montar con el perfil recuperado.
  const [epoch, setEpoch] = useState(0);

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

  // Tras recuperar datos con un codigo: se relee el estado y la sesion arranca con el perfil nuevo.
  const onRecovered = useCallback(() => {
    void loadInitialState(deps).then((state) => {
      setInitial(state);
      setEpoch((value) => value + 1);
    });
  }, [deps]);

  if (!initial) {
    return (
      <div className="app-loading" role="status">
        Cargando
      </div>
    );
  }
  return <Session key={epoch} deps={deps} initial={initial} onRecovered={onRecovered} />;
}

interface SessionProps {
  deps: AppDeps;
  initial: InitialState;
  onRecovered: () => void;
}

function Session({ deps, initial, onRecovered }: SessionProps) {
  const [profile, setProfile] = useState<LocalProfile | null>(
    initial.status === "ready" ? initial.profile : null,
  );
  const [view, setView] = useState<"onboarding" | "main">(initial.status === "ready" ? "main" : "onboarding");
  const [nav, setNav] = useState<NavId>("lectura");
  // El servidor (plan gratuito) puede estar arrancando: recuperar datos avisa en vez de fallar.
  const waking = useWakeState(deps.wake) === "waking";

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

  // Despierta al servidor al abrir (sin bloquear la interfaz); si tardo, sube lo pendiente al despertar.
  useEffect(
    () =>
      watchWake(deps.wake, window, document, () => {
        void deps.syncService.flush().catch(() => {});
      }),
    [deps],
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
            onRecover={deps.restore.restore}
            onRecovered={onRecovered}
            waking={waking}
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
  // El servidor (plan gratuito) puede estar arrancando: la charla avisa en vez de decir "sin conexion".
  const waking = useWakeState(deps.wake) === "waking";
  // Libro elegido con "Leer este libro"; undefined mientras se lee de meta (el boton espera).
  const [chosenId, setChosenId] = useState<string | null | undefined>(undefined);
  const activeBook = resolveActiveBook(library.books, chosenId);
  const focus = useFocusSession(deps.focus, deps.gate);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  // Avance (0 a 1) de "Preparando tu libro" antes de abrir un EPUB sin `locations`; null = no aplica.
  const [preparing, setPreparing] = useState<number | null>(null);
  const [fontPx, setFontPx] = useState<ReaderFontSize>(DEFAULT_FONT_SIZE);
  // Interfaz del lector oculta o visible: local, no se sincroniza; la primera vez, visible.
  const [readerImmersive, setReaderImmersive] = useState(false);
  // El lector no se monta hasta leer sus preferencias (letra e interfaz): si no, abriria con los
  // valores por defecto y se reacomodaria al llegar los guardados.
  const [readerPrefsReady, setReaderPrefsReady] = useState(false);
  // Ultima eleccion del selector Temporizador | Libre: local, no se sincroniza. Un valor guardado
  // que no sea uno de los dos modos cae a Temporizador.
  const [timerType, setTimerType] = useState<TimerType>("TIMER");
  const { theme, toggleTheme } = useTheme();
  // Racha del Dashboard: parte de lo guardado y sube al cerrar una sesion, sin esperar a la red.
  const [streakDays, setStreakDays] = useState(initial?.streakDays ?? 0);
  // Sesion que se esta cerrando. Se fija al terminar y sobrevive a `focus.leave()`: la hoja sigue
  // en pantalla (Paso 2) aunque el registro de la sesion ya se haya borrado.
  const [closing, setClosing] = useState<{
    sessionId: string;
    actualSec: number | null;
    autoChat: boolean;
    timeUp: boolean;
  } | null>(
    null,
  );
  // "Hablar con Komi" del lector: la proxima hoja de cierre abre la charla sola al guardar.
  const [talkNext, setTalkNext] = useState(false);
  // Charla con Komi (CU-05) de la sesion recien guardada; sustituye a la hoja mientras dura.
  const [chat, setChat] = useState<{ sessionId: string; book: LocalBook } | null>(null);

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

  useEffect(() => {
    let alive = true;
    const read = (key: string) => deps.meta.get(key).catch(() => undefined);
    void Promise.all([read(META_KEYS.readerFontSize), read(META_KEYS.readerImmersive)]).then(([size, hidden]) => {
      if (!alive) return;
      if (isFontSize(size)) setFontPx(size);
      setReaderImmersive(hidden === true);
      setReaderPrefsReady(true);
    });
    return () => {
      alive = false;
    };
  }, [deps]);

  useEffect(() => {
    let alive = true;
    deps.meta
      .get(META_KEYS.timerMode)
      .then((value) => alive && setTimerType(isTimerType(value) ? value : "TIMER"))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [deps]);

  const changeTimerType = (next: TimerType) => {
    setTimerType(next);
    deps.meta.set(META_KEYS.timerMode, next).catch(() => {
      // El modo ya cambio en pantalla; solo no quedo guardado para la proxima vez.
    });
  };

  const changeReaderImmersive = (hidden: boolean) => {
    setReaderImmersive(hidden);
    deps.meta.set(META_KEYS.readerImmersive, hidden).catch(() => {
      // Ya cambio en pantalla; solo no quedo guardado para la proxima vez.
    });
  };

  const changeFontPx = (size: ReaderFontSize) => {
    setFontPx(size);
    deps.meta.set(META_KEYS.readerFontSize, size).catch(() => {
      // El tamano ya cambio en pantalla; solo no quedo guardado para la proxima vez.
    });
  };

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

  // Ajustes: el codigo de este dispositivo y "volver a traer mis datos" (mezcla aditiva, Fase 5.3).
  const recovery = profile
    ? {
        code: profile.profile_id,
        onRestore: async () => {
          const outcome = await deps.restore.restore(profile.profile_id);
          if (outcome.kind === "restored") {
            await reload();
            deps.meta
              .getStreakCurrent()
              .then((days) => setStreakDays((previous) => Math.max(previous, days)))
              .catch(() => {});
          }
          return outcome;
        },
      }
    : undefined;

  const onRead = useCallback(
    async (book: LocalBook) => {
      await deps.meta.set(META_KEYS.activeBookId, book.id);
      setChosenId(book.id);
    },
    [deps],
  );

  const snapshot = focus.snapshot;
  // Fin de tiempo del temporizador de un libro fisico (no del modo libre ni del lector EPUB; un
  // "Terminar sesion" antes de cero es `early`, no `completed`): suena el carillon y la hoja de
  // cierre lo avisa por escrito.
  const timeUp =
    snapshot?.phase === "completed" &&
    snapshot.timerType === "TIMER" &&
    library.books.find((candidate) => candidate.id === snapshot.bookId)?.format_type === "PHYSICAL";
  const timeUpSession = timeUp ? snapshot.sessionId : null;
  useEffect(() => {
    if (timeUpSession !== null) deps.endChime.play();
  }, [timeUpSession, deps]);
  if (closing === null && snapshot && (snapshot.phase === "completed" || snapshot.phase === "early")) {
    setClosing({ sessionId: snapshot.sessionId, actualSec: snapshot.actualSec, autoChat: talkNext, timeUp: timeUp });
    if (talkNext) setTalkNext(false);
  }

  // Guardado terminado (CU-04): ya se pueden borrar los registros y soltar la recarga.
  const onReadingSaved = async (result: SavedReading) => {
    setStreakDays(result.streak);
    try {
      await focus.leave();
    } catch {
      // Guardar es idempotente: si el registro queda, la hoja reaparece una vez y se limpia.
    }
    void reload();
    pushChanges();
  };

  const canStart =
    chosenId !== undefined &&
    snapshot === null &&
    !starting &&
    activeBook !== null &&
    canReadBook(activeBook) &&
    (activeBook.format_type === "PHYSICAL" || !library.missingFiles.has(activeBook.id));
  // Un EPUB sin su archivo no se puede abrir: se avisa en vez de dejar el boton mudo.
  const missingEpub =
    activeBook !== null && activeBook.format_type === "EPUB" && library.missingFiles.has(activeBook.id)
      ? activeBook
      : null;

  const startReading = async (minutes: number, timerType: TimerType = "TIMER") => {
    if (!activeBook || !canReadBook(activeBook)) return;
    // Antes de cualquier `await`: Safari solo activa el audio dentro del gesto del usuario.
    if (timerType === "TIMER" && activeBook.format_type === "PHYSICAL") deps.endChime.unlock();
    setStarting(true);
    setStartError(null);
    try {
      if (activeBook.format_type === "EPUB") {
        // Antes de correr el reloj: las locations (porcentaje exacto) deben estar listas.
        const available = await deps.plant.ensureLocations(activeBook.id, () => setPreparing(0), setPreparing);
        if (!available) {
          void library.reload();
          return;
        }
      }
      const common = { sessionId: crypto.randomUUID(), bookId: activeBook.id };
      await focus.start(
        timerType === "FREE" ? { ...common, timerType: "FREE" } : { ...common, plannedSec: minutes * 60 },
      );
    } catch {
      setStartError("No se pudo iniciar la sesión. Intenta de nuevo.");
    } finally {
      setPreparing(null);
      setStarting(false);
    }
  };

  if (preparing !== null) {
    return (
      <div className="app-shell">
        <div className="app-shell__screen app-preparing">
          <PreparationProgress fraction={preparing} />
        </div>
      </div>
    );
  }

  // Sesion en curso: sin navegacion inferior (CU-03, paso 4).
  if (snapshot && (snapshot.phase === "running" || snapshot.phase === "grace")) {
    const sessionBook = library.books.find((book) => book.id === snapshot.bookId) ?? null;
    return (
      <div className="app-shell">
        <div className="app-shell__screen">
          {sessionBook?.format_type === "EPUB" ? (
            readerPrefsReady && (
            <EpubReaderScreen
              key={snapshot.sessionId}
              book={sessionBook}
              snapshot={snapshot}
              reader={deps.epubReader}
              wakeLock={deps.wakeLock}
              theme={theme}
              onToggleTheme={toggleTheme}
              fontPx={fontPx}
              onFontPx={changeFontPx}
              immersive={readerImmersive}
              onImmersive={changeReaderImmersive}
              peekFinish={focus.peekFinish}
              onFinish={focus.acceptFinish}
              onTalkRequested={() => setTalkNext(true)}
              onCancel={focus.leave}
            />
            )
          ) : (
            <PhysicalTimerScreen
              book={sessionBook}
              snapshot={snapshot}
              wakeLock={deps.wakeLock}
              peekFinish={focus.peekFinish}
              onFinish={focus.acceptFinish}
              onCancel={focus.leave}
            />
          )}
        </div>
      </div>
    );
  }

  if (closing !== null && chat !== null) {
    return (
      <div className="app-shell">
        <div className="app-shell__screen">
          <CompanionChatScreen
            key={chat.sessionId}
            service={deps.companion}
            gate={deps.gate}
            waking={waking}
            sessionId={chat.sessionId}
            book={chat.book}
            onLeave={() => {
              setChat(null);
              setClosing(null);
              onNav("lectura");
            }}
          />
        </div>
      </div>
    );
  }

  // Hoja post-lectura (CU-04 y CU-05): sin navegacion, sobre el girasol de la sesion.
  if (closing !== null) {
    return (
      <div className="app-shell">
        <div className="app-shell__screen">
          <PostReadingSheet
            key={closing.sessionId}
            sessionId={closing.sessionId}
            actualSec={closing.actualSec}
            autoChat={closing.autoChat}
            timeUp={closing.timeUp}
            service={deps.postReading}
            onSaved={onReadingSaved}
            onDiscard={focus.leave}
            onChat={(result) => setChat({ sessionId: result.session.id, book: result.book })}
            checkChat={deps.companion.gate}
            waking={waking}
            onDone={() => {
              setClosing(null);
              onNav("lectura");
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="app-shell__screen">
        {snapshot?.phase === "invalidated" && <InvalidatedSessionSheet onClose={() => void focus.leave()} />}
        {missingEpub && nav === "lectura" && !startError && (
          <p className="app-notice" role="status">
            Falta el archivo .epub de «{missingEpub.title}». Vuelve a importarlo desde Mi Jardín para leerlo.
          </p>
        )}
        {startError && (
          <p className="app-notice" role="alert">
            {startError}
          </p>
        )}
        {nav === "lectura" && (
          <DashboardScreen
            key={profile?.daily_goal_minutes}
            streakDays={streakDays}
            book={activeBook}
            dailyGoalMinutes={profile?.daily_goal_minutes ?? 15}
            canStart={canStart}
            timerType={timerType}
            onTimerTypeChange={changeTimerType}
            onStart={(selection) => void startReading(selection.minutes, selection.timerType)}
            recovery={recovery}
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
            seedSource={deps.seeds}
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
