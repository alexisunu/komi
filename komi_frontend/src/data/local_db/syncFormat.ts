// Conversion de registros locales al lote de POST /api/v1/profile/sync/. Los nombres y tipos
// siguen SyncBookSerializer (profiles) y SessionPayloadSerializer (reading_sessions).

import type { LocalBook, LocalSession } from "./types";

export interface SyncBookPayload {
  id: string;
  title: string;
  author: string;
  format_type: LocalBook["format_type"];
  sunflower_variant: LocalBook["sunflower_variant"];
  /** El servidor solo acepta ACTIVE o FALLOW; BLOOMED y GROWING los deriva del progreso. */
  status: "ACTIVE" | "FALLOW";
  total_pages: number | null;
  current_page: number;
  progress_percentage: number;
  last_epub_cfi: string | null;
  updated_at: string;
}

export interface SyncSessionPayload {
  id: string;
  book_id: string;
  planned_duration_sec: number;
  actual_duration_sec: number;
  /** Hora de pared local sin zona: el servidor conserva los digitos y descarta cualquier desfase. */
  started_at_local: string;
  session_status: LocalSession["session_status"];
  current_page?: number;
  progress_percentage?: number;
  last_epub_cfi?: string;
  extracted_epub_excerpt?: string;
}

export interface SyncBatch {
  books: SyncBookPayload[];
  sessions: SyncSessionPayload[];
}

export function toSyncBook(book: LocalBook): SyncBookPayload {
  return {
    id: book.id,
    title: book.title,
    author: book.author,
    format_type: book.format_type,
    sunflower_variant: book.sunflower_variant,
    status: book.status === "FALLOW" ? "FALLOW" : "ACTIVE",
    total_pages: book.total_pages,
    current_page: book.current_page,
    progress_percentage: book.progress_percentage,
    last_epub_cfi: book.last_epub_cfi,
    updated_at: book.updated_at,
  };
}

/**
 * Los campos que no aplican se OMITEN (no van en null): en el servidor son `required=False` pero
 * no admiten null. `progress_delta` y `granted_solar_bonus` no se envian: los recalcula el servidor.
 */
export function toSyncSession(session: LocalSession): SyncSessionPayload {
  const payload: SyncSessionPayload = {
    id: session.id,
    book_id: session.book_id,
    planned_duration_sec: session.planned_duration_sec,
    actual_duration_sec: session.actual_duration_sec,
    started_at_local: session.started_at_local,
    session_status: session.session_status,
  };
  if (session.current_page !== null) payload.current_page = session.current_page;
  if (session.progress_percentage !== null) payload.progress_percentage = session.progress_percentage;
  if (session.last_epub_cfi !== null) payload.last_epub_cfi = session.last_epub_cfi;
  if (session.extracted_epub_excerpt !== null) {
    payload.extracted_epub_excerpt = session.extracted_epub_excerpt;
  }
  return payload;
}

export function buildSyncBatch(
  books: readonly LocalBook[],
  sessions: readonly LocalSession[],
): SyncBatch {
  return { books: books.map(toSyncBook), sessions: sessions.map(toSyncSession) };
}
