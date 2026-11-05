// Dashboard Zen (SRS 6): zonas 1 a 3. La zona 4 (navegacion) la pone el AppShell.
// "Comenzar Lectura" queda deshabilitado hasta la Fase 4 (lector y temporizador real).

import { Settings } from "lucide-react";
import { useState } from "react";
import { StreakBadge } from "../../core/components/StreakBadge";
import { TimerStepperButton } from "../../core/components/TimerStepperButton";
import { ZenPrimaryButton } from "../../core/components/ZenPrimaryButton";
import { ICON_STROKE_WIDTH } from "../../core/theme/geometryTokens";
import type { LocalBook } from "../../data/local_db/types";
import { wholePercent } from "../../services/botanicCalculator";
import { progressLabel } from "./activeBook";
import "./DashboardScreen.css";
import { SettingsPanel } from "./SettingsPanel";
import { SunflowerStageWidget } from "./SunflowerStageWidget";
import {
  formatTimer,
  initialMinutes,
  stepMinutes,
  TIMER_MAX_MINUTES,
  TIMER_MIN_MINUTES,
} from "./timerSelection";

export interface DashboardScreenProps {
  streakDays: number;
  book: LocalBook | null;
  dailyGoalMinutes: number;
}

const ICON_SIZE = 22;
const EMPTY_TITLE = "Tu primera semilla te espera";

export function DashboardScreen({ streakDays, book, dailyGoalMinutes }: DashboardScreenProps) {
  const [minutes, setMinutes] = useState(() => initialMinutes(dailyGoalMinutes));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const percent = book ? wholePercent(book.progress_percentage) : 0;

  return (
    <div className="dashboard">
      <header className="dashboard__header" data-block="header">
        <StreakBadge days={streakDays} />
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
        <ZenPrimaryButton disabled>Comenzar Lectura</ZenPrimaryButton>
      </section>

      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
