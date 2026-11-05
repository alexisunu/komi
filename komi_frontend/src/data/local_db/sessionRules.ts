// Reglas puras de una sesion de lectura. Replican las del servidor para que lo guardado en local
// coincida con lo que /sessions/complete/ y /profile/sync/ van a aceptar:
//   - apps/reading_sessions/services.py (evaluate_session)
//   - apps/reading_sessions/serializers.py (limites)
//   - apps/reading_sessions/streak_engine.py (bono solar)
// El servidor no confia en el estado que dice el cliente: lo deriva de las duraciones.

import { InvalidSessionError, SessionConflictError } from "./errors";
import {
  FULL_HUNDREDTHS,
  pageProgressHundredths,
  toHundredths,
  truncateProgress,
} from "./progressMath";
import type { FormatType, LocalBook, SessionStatus } from "./types";

export const MIN_PLANNED_SEC = 5 * 60;
export const MAX_PLANNED_SEC = 120 * 60;
export const MAX_EXCERPT_CHARS = 20_000;
export const MAX_CFI_CHARS = 2_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Hora de pared local, sin `Z` ni desfase. */
const LOCAL_WALL_CLOCK = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?$/;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** Lo minimo que se necesita de un `Date` para obtener la hora de pared. */
export interface LocalClockSource {
  getFullYear(): number;
  getMonth(): number;
  getDate(): number;
  getHours(): number;
  getMinutes(): number;
  getSeconds(): number;
}

/**
 * Hora de pared local sin zona ("2026-11-05T23:50:00"). Usa los getters locales y NUNCA
 * `toISOString()`, que convertiria a UTC y movería de dia una lectura cercana a la medianoche.
 */
export function formatLocalWallClock(date: LocalClockSource): string {
  const two = (n: number) => String(n).padStart(2, "0");
  const year = String(date.getFullYear()).padStart(4, "0");
  return (
    `${year}-${two(date.getMonth() + 1)}-${two(date.getDate())}` +
    `T${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}`
  );
}

export interface CompleteSessionInput {
  id: string;
  book_id: string;
  planned_duration_sec: number;
  actual_duration_sec: number;
  started_at_local: string;
  /**
   * Solo se respeta INVALIDATED_GRACE_EXPIRED (periodo de gracia vencido). Cualquier otro valor
   * se ignora y el estado se deriva de las duraciones, igual que en el servidor.
   */
  session_status: SessionStatus;
  /** Libro fisico: obligatoria. */
  current_page?: number | undefined;
  /** EPUB: obligatoria (0 a 100, hasta 2 decimales). */
  progress_percentage?: number | undefined;
  last_epub_cfi?: string | undefined;
  extracted_epub_excerpt?: string | null | undefined;
}

function fail(field: string, message: string): never {
  throw new InvalidSessionError(field, message);
}

/** Validacion estructural (equivale a SessionPayloadSerializer). */
export function validateSessionInput(input: CompleteSessionInput): void {
  if (!isUuid(input.id)) fail("id", "El id de la sesion debe ser un UUID.");
  if (!isUuid(input.book_id)) fail("book_id", "El id del libro debe ser un UUID.");
  if (!Number.isInteger(input.planned_duration_sec)) {
    fail("planned_duration_sec", "La duracion programada debe ser un entero.");
  }
  if (
    input.planned_duration_sec < MIN_PLANNED_SEC ||
    input.planned_duration_sec > MAX_PLANNED_SEC
  ) {
    fail("planned_duration_sec", "La duracion programada va de 5 a 120 minutos.");
  }
  if (!Number.isInteger(input.actual_duration_sec) || input.actual_duration_sec < 0) {
    fail("actual_duration_sec", "La duracion real debe ser un entero de cero o mas.");
  }
  if (input.actual_duration_sec > input.planned_duration_sec) {
    fail("actual_duration_sec", "La duracion real no puede superar la programada.");
  }
  if (!LOCAL_WALL_CLOCK.test(input.started_at_local)) {
    fail("started_at_local", "Hora local invalida: se espera AAAA-MM-DDThh:mm:ss, sin zona.");
  }
  const sessionStatuses: SessionStatus[] = ["COMPLETED", "EARLY_VALID", "INVALIDATED_GRACE_EXPIRED"];
  if (!sessionStatuses.includes(input.session_status)) {
    fail("session_status", "Estado de sesion desconocido.");
  }
  if (input.current_page !== undefined) {
    if (!Number.isInteger(input.current_page) || input.current_page < 0) {
      fail("current_page", "La pagina debe ser un entero de cero o mas.");
    }
  }
  if (input.progress_percentage !== undefined) {
    const value = input.progress_percentage;
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      fail("progress_percentage", "El porcentaje va de 0 a 100.");
    }
  }
  if (input.last_epub_cfi !== undefined && input.last_epub_cfi.length > MAX_CFI_CHARS) {
    fail("last_epub_cfi", "El CFI es demasiado largo.");
  }
  const excerpt = input.extracted_epub_excerpt;
  if (typeof excerpt === "string" && excerpt.length > MAX_EXCERPT_CHARS) {
    fail("extracted_epub_excerpt", "El extracto es demasiado largo.");
  }
}

export interface SessionOutcome {
  /** Estado final (derivado). */
  status: SessionStatus;
  /** Una sesion valida cuenta para el progreso y la racha; la invalidada no. */
  valid: boolean;
  newProgressHundredths: number;
  newPage: number;
  /** Avance respecto al guardado, en centesimas de punto porcentual. */
  deltaHundredths: number;
  updateCfi: boolean;
  justBloomed: boolean;
  grantedSolarBonus: boolean;
  /** Lo informado por el lector, ya truncado, para guardarlo en la sesion. */
  reportedPage: number | null;
  reportedProgress: number | null;
}

/** Bono de Vitalidad Solar (SRS 16, punto 4): fisico, sesion valida y avance en [0, 1). */
export function grantsSolarBonus(
  format: FormatType,
  deltaHundredths: number,
  valid: boolean,
): boolean {
  return format === "PHYSICAL" && valid && deltaHundredths >= 0 && deltaHundredths < 100;
}

function deriveStatus(
  input: CompleteSessionInput,
  newHundredths: number,
  previousHundredths: number,
): SessionStatus {
  const { actual_duration_sec: actual, planned_duration_sec: planned } = input;
  if (actual >= planned) return "COMPLETED";
  // Al menos el 50% (>=) o llegar al 100% del libro en esta sesion (RF-02, FA-3.3).
  const reachedFull = newHundredths >= FULL_HUNDREDTHS && previousHundredths < FULL_HUNDREDTHS;
  if (actual * 2 >= planned || reachedFull) return "EARLY_VALID";
  throw new InvalidSessionError(
    "session_status",
    "La sesion no alcanza el 50% de la duracion programada.",
    "below_50_percent",
  );
}

/** Evalua una sesion contra el libro sin escribir nada. Lanza si el servidor la rechazaria. */
export function evaluateSession(book: LocalBook, input: CompleteSessionInput): SessionOutcome {
  const previous = toHundredths(book.progress_percentage);

  if (input.session_status === "INVALIDATED_GRACE_EXPIRED") {
    // Periodo de gracia vencido: no toca progreso ni racha (CLAUDE.md 6).
    return {
      status: "INVALIDATED_GRACE_EXPIRED",
      valid: false,
      newProgressHundredths: previous,
      newPage: book.current_page,
      deltaHundredths: 0,
      updateCfi: false,
      justBloomed: false,
      grantedSolarBonus: false,
      reportedPage: null,
      reportedProgress: null,
    };
  }

  if (book.status === "FALLOW") {
    throw new SessionConflictError("book_fallow", "El libro esta en barbecho; restauralo para leerlo.");
  }
  if (previous >= FULL_HUNDREDTHS) {
    throw new SessionConflictError("book_bloomed", "El libro ya florecio.");
  }

  let reported: number;
  let newPage = book.current_page;
  let reportedPage: number | null = null;
  let reportedProgress: number | null = null;

  if (book.format_type === "PHYSICAL") {
    const page = input.current_page;
    if (page === undefined) fail("current_page", "Es obligatorio para un libro fisico.");
    if (book.total_pages === null || page > book.total_pages) {
      fail("current_page", "Supera el total de paginas del libro.");
    }
    reported = pageProgressHundredths(page, book.total_pages);
    newPage = Math.max(book.current_page, page);
    reportedPage = page;
  } else {
    if (input.progress_percentage === undefined) {
      fail("progress_percentage", "Es obligatorio para un libro EPUB.");
    }
    reportedProgress = truncateProgress(input.progress_percentage);
    reported = toHundredths(reportedProgress);
  }

  // Monotonico: el progreso nunca baja del guardado (SRS 17, punto 8).
  const advanced = reported >= previous;
  const newHundredths = Math.max(previous, reported);
  const status = deriveStatus(input, newHundredths, previous);
  const delta = newHundredths - previous;

  return {
    status,
    valid: true,
    newProgressHundredths: newHundredths,
    newPage,
    deltaHundredths: delta,
    // El CFI solo avanza si la lectura no retrocedio: uno atrasado no pisa uno nuevo.
    updateCfi:
      book.format_type === "EPUB" &&
      advanced &&
      input.last_epub_cfi !== undefined &&
      input.last_epub_cfi !== "",
    justBloomed: newHundredths >= FULL_HUNDREDTHS && previous < FULL_HUNDREDTHS,
    grantedSolarBonus: grantsSolarBonus(book.format_type, delta, true),
    reportedPage,
    reportedProgress,
  };
}
