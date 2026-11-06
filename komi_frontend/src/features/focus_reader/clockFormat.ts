// Formato del reloj de la sesion: "15:00", "04:07", "120:00". Redondea hacia arriba para que
// "00:00" solo se vea al terminar de verdad.

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
