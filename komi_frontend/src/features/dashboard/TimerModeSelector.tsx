// Selector en pastilla "Temporizador | Libre" (mockup 07, SRS 10.7). Un grupo de dos opciones con
// rol radio: las flechas cambian de opcion. Solo tokens del tema.

import type { KeyboardEvent } from "react";
import type { TimerType } from "../../services/focusSessionMachine";
import "./TimerModeSelector.css";

const OPTIONS: ReadonlyArray<{ value: TimerType; label: string }> = [
  { value: "TIMER", label: "Temporizador" },
  { value: "FREE", label: "Libre" },
];

export interface TimerModeSelectorProps {
  value: TimerType;
  onChange: (value: TimerType) => void;
}

export function TimerModeSelector({ value, onChange }: TimerModeSelectorProps) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const other: TimerType = value === "TIMER" ? "FREE" : "TIMER";
    if (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      onChange(other);
      const next = event.currentTarget.querySelector<HTMLElement>(`[data-value="${other}"]`);
      next?.focus();
    }
  };

  return (
    <div className="timer-mode" role="radiogroup" aria-label="Modo de lectura" onKeyDown={onKeyDown}>
      {OPTIONS.map((option) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            data-value={option.value}
            className={`timer-mode__option${checked ? " timer-mode__option--active" : ""}`}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
