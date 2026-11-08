// Lectura estricta de GET /api/v1/profile/sync/restore/ (SRS 11.4, hidratacion; Fase 5.3).
//
// La respuesta viene de la red: si CUALQUIER campo no cumple, se descarta entera (null) y no se
// escribe nada en el dispositivo. Los campos de mas se ignoran; los mensajes de las charlas
// tambien (aqui solo se guarda la semilla del dia).

import { isUuid } from "./sessionRules";
import type {
  AiReflectionStyle,
  BookStatus,
  FormatType,
  LocalBook,
  LocalSession,
  PreferredMoment,
  SessionStatus,
  SunflowerVariant,
} from "./types";

const FORMATS: ReadonlySet<string> = new Set<FormatType>(["EPUB", "PHYSICAL"]);
const VARIANTS: ReadonlySet<string> = new Set<SunflowerVariant>(["CLASSIC", "SOLAR", "AUTUMN"]);
const STATUSES: ReadonlySet<string> = new Set<BookStatus>(["ACTIVE", "GROWING", "BLOOMED", "FALLOW"]);
const SESSION_STATUSES: ReadonlySet<string> = new Set<SessionStatus>([
  "COMPLETED",
  "EARLY_VALID",
  "INVALIDATED_GRACE_EXPIRED",
]);
const MOMENTS: ReadonlySet<string> = new Set<PreferredMoment>(["MORNING", "AFTERNOON", "NIGHT", "COMMUTE"]);
const STYLES: ReadonlySet<string> = new Set<AiReflectionStyle>(["MEMORY_QUIZ", "DEEP_ANALYSIS", "KEY_SUMMARY"]);
/** Hora de pared local, sin `Z` ni desfase (el servidor la devuelve asi). */
const LOCAL_WALL_CLOCK = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?$/;
const MAX_TOTAL_PAGES = 100_000;
const MAX_TEXT_CHARS = 255;

export interface RestoreProfile {
  profile_id: string;
  daily_goal_minutes: number;
  preferred_moment: PreferredMoment;
  ai_reflection_style: AiReflectionStyle;
}

export interface RestoreStreak {
  current: number;
  longest: number;
  last_valid_session_date: string | null;
}

export type RestoreBook = Omit<LocalBook, "pending_sync">;

/** Lo que el servidor sabe de una sesion; el resto de campos locales nace en null. */
export type RestoreSession = Pick<
  LocalSession,
  | "id"
  | "book_id"
  | "planned_duration_sec"
  | "actual_duration_sec"
  | "started_at_local"
  | "session_status"
  | "progress_delta"
  | "granted_solar_bonus"
>;

export interface RestoreChat {
  chat_id: string;
  session_id: string;
  turn_count: number;
  is_closed: boolean;
  key_takeaway: string | null;
}

export interface RestorePayload {
  profile: RestoreProfile;
  streak: RestoreStreak | null;
  books: RestoreBook[];
  sessions: RestoreSession[];
  chats: RestoreChat[];
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isInt = (value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
const isDateText = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
const isText = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= MAX_TEXT_CHARS;
const isOneOf = (set: ReadonlySet<string>, value: unknown): boolean => typeof value === "string" && set.has(value);

function parseProfile(value: unknown): RestoreProfile | null {
  if (!isObject(value)) return null;
  const { profile_id, daily_goal_minutes, preferred_moment, ai_reflection_style } = value;
  if (!isUuid(profile_id) || !isInt(daily_goal_minutes, 1, 1440)) return null;
  if (!isOneOf(MOMENTS, preferred_moment) || !isOneOf(STYLES, ai_reflection_style)) return null;
  return {
    profile_id: profile_id.toLowerCase(),
    daily_goal_minutes,
    preferred_moment: preferred_moment as PreferredMoment,
    ai_reflection_style: ai_reflection_style as AiReflectionStyle,
  };
}

function parseStreak(value: unknown): RestoreStreak | null | undefined {
  // `undefined` = invalida; `null` = el servidor no la informo.
  if (value === null || value === undefined) return null;
  if (!isObject(value)) return undefined;
  const { current, longest, last_valid_session_date: last } = value;
  if (!isInt(current, 0) || !isInt(longest, 0)) return undefined;
  if (last !== null && last !== undefined && typeof last !== "string") return undefined;
  return { current, longest, last_valid_session_date: typeof last === "string" ? last : null };
}

function parseBook(value: unknown): RestoreBook | null {
  if (!isObject(value)) return null;
  const v = value;
  if (!isUuid(v["id"]) || !isText(v["title"]) || !isText(v["author"])) return null;
  if (!isOneOf(FORMATS, v["format_type"]) || !isOneOf(VARIANTS, v["sunflower_variant"])) return null;
  if (!isOneOf(STATUSES, v["status"])) return null;
  const progress = v["progress_percentage"];
  if (typeof progress !== "number" || !Number.isFinite(progress) || progress < 0 || progress > 100) return null;
  const pages = v["total_pages"];
  if (pages !== null && !isInt(pages, 1, MAX_TOTAL_PAGES)) return null;
  if (!isInt(v["current_page"], 0)) return null;
  const cfi = v["last_epub_cfi"];
  if (cfi !== null && typeof cfi !== "string") return null;
  const completed = v["completed_at"];
  if (!isDateText(v["created_at"]) || !isDateText(v["updated_at"])) return null;
  if (completed !== null && !isDateText(completed)) return null;
  return {
    id: (v["id"] as string).toLowerCase(),
    title: (v["title"] as string).trim(),
    author: (v["author"] as string).trim(),
    format_type: v["format_type"] as FormatType,
    sunflower_variant: v["sunflower_variant"] as SunflowerVariant,
    status: v["status"] as BookStatus,
    total_pages: pages,
    current_page: v["current_page"] as number,
    progress_percentage: progress,
    last_epub_cfi: cfi,
    created_at: v["created_at"] as string,
    completed_at: completed,
    updated_at: v["updated_at"] as string,
  };
}

function parseSession(value: unknown): RestoreSession | null {
  if (!isObject(value)) return null;
  const v = value;
  if (!isUuid(v["id"]) || !isUuid(v["book_id"])) return null;
  if (!isInt(v["planned_duration_sec"], 0) || !isInt(v["actual_duration_sec"], 0)) return null;
  const started = v["started_at_local"];
  if (typeof started !== "string" || !LOCAL_WALL_CLOCK.test(started)) return null;
  if (!isOneOf(SESSION_STATUSES, v["session_status"])) return null;
  const delta = v["progress_delta"];
  if (typeof delta !== "number" || !Number.isFinite(delta)) return null;
  if (typeof v["granted_solar_bonus"] !== "boolean") return null;
  return {
    id: (v["id"] as string).toLowerCase(),
    book_id: (v["book_id"] as string).toLowerCase(),
    planned_duration_sec: v["planned_duration_sec"] as number,
    actual_duration_sec: v["actual_duration_sec"] as number,
    started_at_local: started,
    session_status: v["session_status"] as SessionStatus,
    progress_delta: delta,
    granted_solar_bonus: v["granted_solar_bonus"],
  };
}

function parseChat(value: unknown): RestoreChat | null {
  if (!isObject(value)) return null;
  const v = value;
  if (!isUuid(v["chat_id"]) || !isUuid(v["session_id"])) return null;
  if (!isInt(v["turn_count"], 1, 5) || typeof v["is_closed"] !== "boolean") return null;
  const takeaway = v["key_takeaway"];
  if (takeaway !== null && typeof takeaway !== "string") return null;
  return {
    chat_id: (v["chat_id"] as string).toLowerCase(),
    session_id: (v["session_id"] as string).toLowerCase(),
    turn_count: v["turn_count"] as number,
    is_closed: v["is_closed"],
    key_takeaway: takeaway,
  };
}

function parseList<T>(value: unknown, parseItem: (item: unknown) => T | null): T[] | null {
  if (!Array.isArray(value)) return null;
  const items: T[] = [];
  for (const item of value) {
    const parsed = parseItem(item);
    if (parsed === null) return null;
    items.push(parsed);
  }
  return items;
}

/** Devuelve la respuesta ya validada y normalizada, o null si algo no cumple. */
export function parseRestorePayload(data: unknown): RestorePayload | null {
  if (!isObject(data)) return null;
  const profile = parseProfile(data["profile"]);
  const streak = parseStreak(data["streak"]);
  const books = parseList(data["books"], parseBook);
  const sessions = parseList(data["sessions"], parseSession);
  const chats = parseList(data["chats"], parseChat);
  if (!profile || streak === undefined || !books || !sessions || !chats) return null;
  return { profile, streak, books, sessions, chats };
}
