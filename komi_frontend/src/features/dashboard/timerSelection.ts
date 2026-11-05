// Selector de tiempo del Dashboard (CU-03, paso 1): de 5:00 a 120:00 en pasos de 5 minutos.
// Solo es la eleccion en pantalla; el temporizador real (marcas de tiempo) llega en la Fase 4.

export const TIMER_MIN_MINUTES = 5;
export const TIMER_MAX_MINUTES = 120;
export const TIMER_STEP_MINUTES = 5;

export type TimerDirection = "decrement" | "increment";

function clamp(minutes: number): number {
  return Math.min(TIMER_MAX_MINUTES, Math.max(TIMER_MIN_MINUTES, minutes));
}

/** Meta diaria del plan llevada al selector: multiplo de 5 mas cercano, dentro de 5 a 120. */
export function initialMinutes(dailyGoal: number): number {
  if (!Number.isFinite(dailyGoal)) return clamp(15);
  return clamp(Math.round(dailyGoal / TIMER_STEP_MINUTES) * TIMER_STEP_MINUTES);
}

export function stepMinutes(current: number, direction: TimerDirection): number {
  const delta = direction === "increment" ? TIMER_STEP_MINUTES : -TIMER_STEP_MINUTES;
  return clamp(initialMinutes(current) + delta);
}

/** "15:00", "05:00", "120:00". */
export function formatTimer(minutes: number): string {
  return `${String(clamp(minutes)).padStart(2, "0")}:00`;
}
