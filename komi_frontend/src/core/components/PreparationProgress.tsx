// "Preparando tu libro" con avance real (CU-02 y lector). `fraction` va de 0 a 1 y sale de los
// capitulos ya procesados; no es una animacion de relleno.

import "./PreparationProgress.css";

export interface PreparationProgressProps {
  /** 0 a 1. `null` mientras todavia no hay un primer avance. */
  fraction: number | null;
  label?: string;
}

export function percentOf(fraction: number | null): number {
  if (fraction === null || !Number.isFinite(fraction)) return 0;
  return Math.min(100, Math.max(0, Math.floor(fraction * 100)));
}

export function PreparationProgress({ fraction, label = "Preparando tu libro" }: PreparationProgressProps) {
  const percent = percentOf(fraction);
  return (
    <div className="preparation">
      <p className="preparation__label" role="status">
        {label}
      </p>
      <div
        className="preparation__bar"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <div className="preparation__fill" style={{ width: `${percent}%` }} />
      </div>
      <p className="preparation__percent tabular">{percent} %</p>
    </div>
  );
}
