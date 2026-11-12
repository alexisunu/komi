// Dashboard Zen (SRS 6): zonas 1 a 3. La zona 4 (navegacion) la pone el AppShell.
// El boton principal, "Comenzar lectura" para un libro fisico y para un EPUB, se activa con un libro
// que se pueda leer (CU-03; un EPUB ademas exige su archivo en el dispositivo). Bajo el libro, el
// selector Temporizador | Libre (mockup 07): con Temporizador, los minutos; con Libre, un texto.

import { Infinity as InfinityIcon, Settings } from "lucide-react";
import { useState } from "react";
import { FEATURES } from "../../core/featureFlags";
import { StreakBadge } from "../../core/components/StreakBadge";
import { TimerStepperButton } from "../../core/components/TimerStepperButton";
import { ZenPrimaryButton } from "../../core/components/ZenPrimaryButton";
import { ICON_STROKE_WIDTH } from "../../core/theme/geometryTokens";
import type { LocalBook } from "../../data/local_db/types";
import { wholePercent } from "../../services/botanicCalculator";
import type { TimerType } from "../../services/focusSessionMachine";
import { progressLabel } from "./activeBook";
import "./DashboardScreen.css";
import { SettingsPanel, type SettingsRecovery } from "./SettingsPanel";
import { SunflowerStageWidget } from "./SunflowerStageWidget";
import { TimerModeSelector } from "./TimerModeSelector";
import {
  formatTimer,
  initialMinutes,
  stepMinutes,
  TIMER_MAX_MINUTES,
  TIMER_MIN_MINUTES,
} from "./timerSelection";

/** Lo que pide el lector al empezar: el modo y los minutos del selector (solo cuentan en TIMER). */
export interface StartSelection {
  timerType: TimerType;
  minutes: number;
}

export interface DashboardScreenProps {
  streakDays: number;
  /** Muestra la racha. Por defecto, la bandera de la app (apagada en la v2); las pruebas lo fuerzan. */
  showStreak?: boolean;
  book: LocalBook | null;
  dailyGoalMinutes: number;
  /** Hay libro, se puede leer y no hay otra sesion. Sin esto el boton queda deshabilitado. */
  canStart?: boolean;
  /** Modo elegido. Sin esta prop el selector lleva su propio estado (empieza en Temporizador). */
  timerType?: TimerType;
  /** Se llama al cambiar de modo, para recordar la ultima eleccion. */
  onTimerTypeChange?: (timerType: TimerType) => void;
  /** Inicia la sesion con el modo y los minutos del selector. */
  onStart?: (selection: StartSelection) => void;
  /** Codigo de recuperacion del dispositivo y "volver a traer mis datos" (Ajustes, Fase 5.3). */
  recovery?: SettingsRecovery | undefined;
}

const ICON_SIZE = 22;
const EMPTY_TITLE = "Tu primera semilla te espera";

export function DashboardScreen({
  streakDays,
  showStreak = FEATURES.statsAndStreak,
  book,
  dailyGoalMinutes,
  canStart = false,
  timerType: chosenType,
  onTimerTypeChange,
  onStart,
  recovery,
}: DashboardScreenProps) {
  const [minutes, setMinutes] = useState(() => initialMinutes(dailyGoalMinutes));
  const [ownType, setOwnType] = useState<TimerType>("TIMER");
  const timerType = chosenType ?? ownType;
  const changeType = (next: TimerType) => {
    setOwnType(next);
    onTimerTypeChange?.(next);
  };
  const [settingsOpen, setSettingsOpen] = useState(false);
  const percent = book ? wholePercent(book.progress_percentage) : 0;

  return (
    <div className="dashboard">
      <header className="dashboard__header" data-block="header">
        {showStreak ? <StreakBadge days={streakDays} /> : <span className="dashboard__brand">Komi</span>}
        <button
          type="button"
          className="dashboard__settings"
          aria-label="Ajustes"
          aria-haspopup="dialog"
          onClick={() => setSettingsOpen(true)}
        >
          <Settings size={ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" />
        </button>
      </header>

      <section className="dashboard__canvas" data-block="canvas" aria-label="Libro en curso">
        <SunflowerStageWidget
          percentage={book?.progress_percentage ?? 0}
          fallow={book?.status === "FALLOW"}
          size={200}
        />
        {book ? (
          <>
            <h1 className="dashboard__book-title">{book.title}</h1>
            <p className="dashboard__book-author">{book.author}</p>
            <div
              className="dashboard__progress"
              role="progressbar"
              aria-label="Progreso del libro"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
            >
              <div className="dashboard__progress-fill" style={{ width: `${percent}%` }} />
            </div>
            <p className="dashboard__progress-text tabular">{progressLabel(book)}</p>
          </>
        ) : (
          <h1 className="dashboard__book-title">{EMPTY_TITLE}</h1>
        )}
      </section>

      <section className="dashboard__controls" data-block="controls" aria-label="Sesión de lectura">
        <TimerModeSelector value={timerType} onChange={changeType} />
        {timerType === "FREE" ? (
          <p className="dashboard__free">
            <InfinityIcon size={ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" />
            <span>Sin límite de tiempo. El cronómetro empieza al abrir el lector.</span>
          </p>
        ) : (
          <div className="dashboard__timer">
            <TimerStepperButton
              direction="decrement"
              aria-label="Restar 5 minutos"
              disabled={minutes <= TIMER_MIN_MINUTES}
              onClick={() => setMinutes((value) => stepMinutes(value, "decrement"))}
            />
            <output className="dashboard__time tabular" aria-label="Duración de la sesión">
              {formatTimer(minutes)}
            </output>
            <TimerStepperButton
              direction="increment"
              aria-label="Sumar 5 minutos"
              disabled={minutes >= TIMER_MAX_MINUTES}
              onClick={() => setMinutes((value) => stepMinutes(value, "increment"))}
            />
          </div>
        )}
        <ZenPrimaryButton disabled={!canStart || !onStart} onClick={() => onStart?.({ timerType, minutes })}>
          Comenzar lectura
        </ZenPrimaryButton>
      </section>

      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} recovery={recovery} />}
    </div>
  );
}
