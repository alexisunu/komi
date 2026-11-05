// Racha calculada en el dispositivo (RF-06, SRS 16 punto 2). Espejo de `streak_engine.py`
// (`recompute_from_dates` y `effective_streak`); la prueba consume `streakCases.json`, generado
// por `python manage.py dump_streak_cases`. El servidor manda: su valor sobrescribe este al sincronizar.
//
// Solo se lee la FECHA de `started_at_local` (hora de pared sin zona): nunca se convierte, para que
// una lectura de las 23:50 cuente en su dia aunque termine despues de la medianoche.

export interface StreakSessionInput {
  started_at_local: string;
  session_status: string;
  /** Rechazo permanente del servidor: la sesion no cuenta para la racha local (SRS 19). */
  sync_rejection?: string | null;
}

export interface StreakResult {
  current: number;
  longest: number;
  /** "AAAA-MM-DD" o null sin sesiones validas. */
  last_date: string | null;
  /** Racha a mostrar hoy: 0 si pasaron mas de 1 dia calendario sin leer. */
  effective: number;
}

const VALID_STATUSES = new Set(["COMPLETED", "EARLY_VALID"]);
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})/;
const DAY_MS = 86_400_000;

/** Dias desde 1970 de una fecha "AAAA-MM-DD", sin zonas horarias ni horario de verano. */
function dayNumber(date: string): number | null {
  const match = DATE_PATTERN.exec(date);
  if (!match) return null;
  const [, year, month, day] = match;
  return Math.floor(Date.UTC(Number(year), Number(month) - 1, Number(day)) / DAY_MS);
}

function dayToIso(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Racha a mostrar hoy a partir de la racha que termina en `lastDate`: 0 si pasaron mas de 1 dia
 * calendario sin leer. Con una fecha ilegible no se inventa un cero: se conserva la racha.
 */
export function effectiveStreak(current: number, lastDate: string | null, todayLocal: string): number {
  if (lastDate === null) return 0;
  const last = dayNumber(lastDate);
  const today = dayNumber(todayLocal);
  return last !== null && today !== null && today - last > 1 ? 0 : current;
}

export function computeStreak(
  sessions: readonly StreakSessionInput[],
  todayLocal: string,
  previousLongest = 0,
): StreakResult {
  const days = new Set<number>();
  for (const session of sessions) {
    if (!VALID_STATUSES.has(session.session_status)) continue;
    if (session.sync_rejection) continue;
    const day = dayNumber(session.started_at_local);
    if (day !== null) days.add(day);
  }

  const sorted = [...days].sort((a, b) => a - b);
  if (sorted.length === 0) {
    return { current: 0, longest: previousLongest, last_date: null, effective: 0 };
  }

  let run = 1;
  let longestRun = 1;
  let last = sorted[0] ?? 0;
  for (const day of sorted.slice(1)) {
    run = day - last === 1 ? run + 1 : 1;
    longestRun = Math.max(longestRun, run);
    last = day;
  }

  const lastDate = dayToIso(last);
  return {
    current: run,
    longest: Math.max(previousLongest, longestRun),
    last_date: lastDate,
    effective: effectiveStreak(run, lastDate, todayLocal),
  };
}
