// Formato del reloj de la sesion: "15:00", "04:07", "120:00". Redondea hacia arriba para que
// "00:00" solo se vea al terminar de verdad.

/**
 * Cronometro del modo libre: cuenta hacia arriba, "00:00" al empezar, "mm:ss" y, pasada la hora,
 * "h:mm:ss". Trunca (los segundos ya cumplidos), al reves que `formatClock`.
 */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return hours > 0 ? `${hours}:${two(minutes)}:${two(seconds)}` : `${two(minutes)}:${two(seconds)}`;
}

/** Lo que muestra el reloj de la sesion segun el modo: restante (temporizador) o transcurrido (libre). */
export function sessionClock(snapshot: { timerType: string; remainingMs: number; elapsedMs: number }): string {
  return snapshot.timerType === "FREE" ? formatElapsed(snapshot.elapsedMs) : formatClock(snapshot.remainingMs);
}

/** "Modo libre" o "Temporizador" y, si se conoce, el avance del libro: "Modo libre · 12 %". */
export function sessionSubtitle(timerType: string, percentage: number | null): string {
  const mode = timerType === "FREE" ? "Modo libre" : "Temporizador";
  return percentage === null ? mode : `${mode} · ${Math.floor(percentage)} %`;
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
