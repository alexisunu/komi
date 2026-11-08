// Respuesta de GET /profile/sync/restore/ con la forma EXACTA del servidor (BookSerializer,
// serialize_session, serialize_chat y streak_payload), incluidos los campos que el cliente ignora.

import { uuid } from "./db";

export const RESTORE_PROFILE_ID = uuid(900);
export const BOOK_PHYSICAL = uuid(901);
export const BOOK_EPUB = uuid(902);
export const SESSION_PHYSICAL = uuid(911);
export const SESSION_EPUB = uuid(912);
export const CHAT_ID = uuid(921);

type Json = Record<string, unknown>;

export function serverBook(id: string, over: Json = {}): Json {
  return {
    id,
    title: "Libro del servidor",
    author: "Autora",
    format_type: "PHYSICAL",
    sunflower_variant: "CLASSIC",
    growth_stage: "STEM_1", // el cliente lo ignora
    status: "ACTIVE",
    progress_percentage: 40,
    total_pages: 300,
    current_page: 120,
    last_epub_cfi: null,
    created_at: "2026-10-01T10:00:00Z",
    completed_at: null,
    updated_at: "2026-11-04T10:00:00Z",
    ...over,
  };
}

export function serverSession(id: string, bookId: string, over: Json = {}): Json {
  return {
    id,
    book_id: bookId,
    planned_duration_sec: 900,
    actual_duration_sec: 900,
    started_at_local: "2026-11-04T21:30:00",
    session_status: "COMPLETED",
    progress_delta: 4,
    granted_solar_bonus: false,
    ...over,
  };
}

export function serverChat(id: string, sessionId: string, over: Json = {}): Json {
  return {
    chat_id: id,
    session_id: sessionId,
    turn_count: 5,
    is_closed: true,
    key_takeaway: "Leer es escuchar despacio.",
    messages: [
      { id: 1, sender: "KOMI_AI", content: "Hola", turn_number: 1, created_at: "2026-11-04T21:50:00Z" },
    ],
    ...over,
  };
}

/** Un perfil con un libro fisico, un EPUB, dos sesiones y una charla cerrada. */
export function restoreBody(over: Json = {}): Json {
  return {
    profile: {
      profile_id: RESTORE_PROFILE_ID,
      daily_goal_minutes: 20,
      preferred_moment: "NIGHT",
      ai_reflection_style: "KEY_SUMMARY",
    },
    streak: { current: 3, longest: 5, last_valid_session_date: "2026-11-05" },
    books: [
      serverBook(BOOK_PHYSICAL, { title: "Libro fisico" }),
      serverBook(BOOK_EPUB, {
        title: "Libro EPUB",
        format_type: "EPUB",
        total_pages: null,
        current_page: 0,
        progress_percentage: 10,
        last_epub_cfi: "epubcfi(/6/4!/4/2)",
      }),
    ],
    sessions: [serverSession(SESSION_PHYSICAL, BOOK_PHYSICAL), serverSession(SESSION_EPUB, BOOK_EPUB)],
    chats: [serverChat(CHAT_ID, SESSION_PHYSICAL)],
    ...over,
  };
}
