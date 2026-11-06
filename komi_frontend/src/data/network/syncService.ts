// Envio de libros y sesiones pendientes a POST /api/v1/profile/sync/ (SRS 11.4, 17.18, 19).
//
// Es el UNICO camino de subida: el cliente no llama a /sessions/complete/. Se invoca justo despues de
// guardar una sesion (escritura inmediata de 11.4), al abrir la app y al volver la red.
//
// Reglas:
//  - Los libros viajan primero; un libro que una sesion pendiente necesita se envia siempre en el
//    mismo lote (la fusion es idempotente), asi nunca hay `book_not_found` por orden.
//  - Limites del servidor: 100 libros y 200 sesiones por peticion; el extracto solo en la sesion
//    mas reciente de cada peticion (el cuerpo cuenta entero para el limite de 2,5 MB).
//  - Rechazo PERMANENTE (tabla de 17.18): la sesion NO se borra; se marca con el codigo, sale de la
//    cola y no cuenta para la racha local. `updated_at_in_future` es reintentable.
//  - Un codigo desconocido no se descarta: la sesion sigue pendiente y se registra el aviso.
//  - La racha del servidor se guarda solo cuando todo lo pendiente quedo sincronizado, para no
//    pisar la local con un valor parcial.
//  - Nunca se escribe el UUID del perfil en logs.

import { getDatabase, type KomiDatabase } from "../local_db/dexieDatabase";
import { createLocalBookRepository, systemClock, type LocalClock } from "../local_db/localBookRepository";
import { createLocalMetaRepository, META_KEYS } from "../local_db/localMetaRepository";
import { createLocalSessionRepository } from "../local_db/localSessionRepository";
import { formatLocalWallClock } from "../local_db/sessionRules";
import { guardStorage } from "../local_db/storageGuard";
import { buildSyncBatch, type SyncBatch } from "../local_db/syncFormat";
import type { LocalBook, LocalSession } from "../local_db/types";
import { effectiveStreak } from "../../services/localStreak";
import { ApiError, getApiClient, type ApiClient } from "./apiClient";

export const SYNC_PATH = "/profile/sync/";
export const MAX_BOOKS_PER_REQUEST = 100;
export const MAX_SESSIONS_PER_REQUEST = 200;

/** Reintentable: el mismo elemento puede aceptarse despues de corregir el reloj. */
const RETRYABLE_CODES = new Set(["updated_at_in_future"]);
/** Permanentes (SRS 17.18): reintentar tal cual fallaria igual. */
const PERMANENT_CODES = new Set([
  "validation_error",
  "below_50_percent",
  "future_start",
  "book_not_found",
  "book_rejected",
  "id_conflict",
  "duplicate_in_batch",
]);

interface RejectedItem {
  id: string;
  code: string;
}

interface ItemsReport {
  accepted: string[];
  rejected: RejectedItem[];
}

export interface ServerStreak {
  current: number;
  longest: number;
  last_valid_session_date: string | null;
}

export interface ParsedSyncResponse {
  books: ItemsReport;
  sessions: ItemsReport;
  streak: ServerStreak | null;
}

function parseReport(value: unknown): ItemsReport | null {
  if (typeof value !== "object" || value === null) return null;
  const { accepted, rejected } = value as { accepted?: unknown; rejected?: unknown };
  if (!Array.isArray(accepted) || !Array.isArray(rejected)) return null;
  const okIds: string[] = [];
  for (const item of accepted) {
    const id = (item as { id?: unknown } | null)?.id;
    if (typeof id !== "string") return null;
    okIds.push(id);
  }
  const bad: RejectedItem[] = [];
  for (const item of rejected) {
    const { id, code } = (item ?? {}) as { id?: unknown; code?: unknown };
    if (typeof id !== "string" || typeof code !== "string") return null;
    bad.push({ id, code });
  }
  return { accepted: okIds, rejected: bad };
}

function parseStreak(value: unknown): ServerStreak | null {
  if (typeof value !== "object" || value === null) return null;
  const { current, longest, last_valid_session_date: last } = value as Record<string, unknown>;
  if (typeof current !== "number" || !Number.isInteger(current) || current < 0) return null;
  if (typeof longest !== "number" || !Number.isInteger(longest) || longest < 0) return null;
  if (last !== null && last !== undefined && typeof last !== "string") return null;
  return { current, longest, last_valid_session_date: typeof last === "string" ? last : null };
}

export function parseSyncResponse(data: unknown): ParsedSyncResponse | null {
  if (typeof data !== "object" || data === null) return null;
  const { books, sessions, streak } = data as Record<string, unknown>;
  const parsedBooks = parseReport(books);
  const parsedSessions = parseReport(sessions);
  if (!parsedBooks || !parsedSessions) return null;
  return { books: parsedBooks, sessions: parsedSessions, streak: parseStreak(streak) };
}

/**
 * Reparte el trabajo en peticiones: primero los libros (de 100 en 100) y despues las sesiones, en
 * orden cronologico (de 200 en 200). La primera tanda de sesiones va con la ultima de libros.
 * El extracto solo queda en la sesion mas reciente de cada peticion.
 */
export function planRequests(
  books: readonly LocalBook[],
  sessions: readonly LocalSession[],
): Array<{ books: LocalBook[]; sessions: LocalSession[] }> {
  const bookChunks: LocalBook[][] = [];
  for (let i = 0; i < books.length; i += MAX_BOOKS_PER_REQUEST) {
    bookChunks.push(books.slice(i, i + MAX_BOOKS_PER_REQUEST));
  }
  const sessionChunks: LocalSession[][] = [];
  for (let i = 0; i < sessions.length; i += MAX_SESSIONS_PER_REQUEST) {
    sessionChunks.push(sessions.slice(i, i + MAX_SESSIONS_PER_REQUEST));
  }

  const requests: Array<{ books: LocalBook[]; sessions: LocalSession[] }> = [];
  bookChunks.forEach((chunk) => requests.push({ books: chunk, sessions: [] }));
  sessionChunks.forEach((chunk, index) => {
    const last = requests[requests.length - 1];
    if (index === 0 && last) last.sessions = chunk;
    else requests.push({ books: [], sessions: chunk });
  });

  return requests.map((request) => ({
    books: request.books,
    sessions: request.sessions.map((session, index) =>
      index === request.sessions.length - 1 || session.extracted_epub_excerpt === null
        ? session
        : { ...session, extracted_epub_excerpt: null },
    ),
  }));
}

export type SyncStatus =
  | "nothing" // no hay nada pendiente
  | "synced" // todo lo pendiente quedo en el servidor (o descartado de forma permanente)
  | "partial" // alguna peticion fallo; lo enviado quedo marcado, el resto sigue pendiente
  | "retry_later" // sin red, tiempo agotado, 429, 5xx o respuesta invalida: nada cambio
  | "unauthorized" // 401: el servidor no conoce al perfil (onboarding sin confirmar)
  | "failed" // 4xx permanente de la peticion completa (413, 400): nada se descarta
  | "not_configured"; // sin VITE_API_URL valida

/** Por que fallo una corrida: sin red o tiempo agotado (`network`) u otra respuesta del servidor (`http`). */
export type SyncCause = "network" | "http";

/**
 * Estado de una sesion para abrir el chat. `offline` y `unsynced` se pueden reintentar;
 * `rejected` es permanente (el servidor la invalida, por ejemplo `below_50_percent`).
 */
export type SessionGate =
  | { state: "ready" }
  | { state: "offline" }
  | { state: "unsynced" }
  | { state: "rejected"; code: string };

export interface SyncResult {
  status: SyncStatus;
  /** Solo en `retry_later`, `partial`, `failed` y `unauthorized`. */
  cause: SyncCause | null;
  sentBooks: number;
  sentSessions: number;
  /** Sesiones descartadas de forma permanente en esta corrida. */
  rejectedSessions: RejectedItem[];
  /** Racha efectiva hoy, solo cuando el servidor la informo y no queda nada pendiente. */
  streak: number | null;
}

const EMPTY: SyncResult = {
  status: "nothing",
  cause: null,
  sentBooks: 0,
  sentSessions: 0,
  rejectedSessions: [],
  streak: null,
};

export interface SyncServiceOptions {
  db?: KomiDatabase;
  api?: ApiClient;
  clock?: LocalClock;
  log?: Pick<Console, "warn" | "error">;
  /**
   * Ante un 401 (el servidor no conoce al perfil porque el onboarding sigue en cola), intenta
   * confirmarlo y devuelve true si conviene reintentar una vez.
   */
  recoverUnauthorized?: () => Promise<boolean>;
}

type RejectionMap = Record<string, string>;

function parseRejections(raw: unknown): RejectionMap {
  if (typeof raw !== "string") return {};
  try {
    const value = JSON.parse(raw) as unknown;
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as RejectionMap) : {};
  } catch {
    return {};
  }
}

export function createSyncService(options: SyncServiceOptions = {}) {
  const db = options.db ?? getDatabase();
  const api = options.api ?? getApiClient();
  const clock = options.clock ?? systemClock;
  const log = options.log ?? console;
  const books = createLocalBookRepository(db, clock);
  const sessions = createLocalSessionRepository(db, clock);
  const meta = createLocalMetaRepository(db);
  let inFlight: Promise<SyncResult> | null = null;
  let rerun = false;

  async function loadRejectedBooks(): Promise<RejectionMap> {
    return parseRejections(await meta.get(META_KEYS.syncBookRejections));
  }

  async function collect(): Promise<{ books: LocalBook[]; sessions: LocalSession[] }> {
    const rejectedBooks = await loadRejectedBooks();
    const pendingSessions = (await sessions.listPendingSessions()).filter(
      (session) => rejectedBooks[session.book_id] === undefined,
    );
    const pendingBooks = (await books.listPendingBooks()).filter((book) => rejectedBooks[book.id] === undefined);

    // Un libro que una sesion pendiente necesita viaja siempre en el mismo lote.
    const byId = new Map(pendingBooks.map((book) => [book.id, book]));
    for (const session of pendingSessions) {
      if (!byId.has(session.book_id) && rejectedBooks[session.book_id] === undefined) {
        const book = await books.getBook(session.book_id);
        if (book) byId.set(book.id, book);
      }
    }
    return { books: [...byId.values()], sessions: pendingSessions };
  }

  async function post(batch: SyncBatch): Promise<ParsedSyncResponse> {
    const attempt = () => api.post<unknown>(SYNC_PATH, { body: batch });
    let result;
    try {
      result = await attempt();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401 && options.recoverUnauthorized) {
        if (await options.recoverUnauthorized()) result = await attempt();
        else throw error;
      } else {
        throw error;
      }
    }
    const parsed = parseSyncResponse(result.data);
    if (!parsed) throw new ApiError("invalid_response", "Respuesta de sync inesperada.", result.status, true);
    return parsed;
  }

  async function applyResponse(
    request: { books: LocalBook[]; sessions: LocalSession[] },
    response: ParsedSyncResponse,
    rejectedSessions: RejectedItem[],
  ): Promise<void> {
    const bookById = new Map(request.books.map((book) => [book.id, book]));

    // Libros aceptados: se limpia la marca solo si no cambiaron durante el envio.
    await books.markBooksSynced(
      response.books.accepted.flatMap((id) => {
        const sent = bookById.get(id);
        return sent ? [{ id, updated_at: sent.updated_at }] : [];
      }),
    );

    // Libros rechazados: permanentes se registran y dejan de enviarse; el reloj adelantado, no.
    const retryableBookRejections = new Set<string>();
    const permanentBooks: RejectionMap = {};
    for (const { id, code } of response.books.rejected) {
      if (RETRYABLE_CODES.has(code)) retryableBookRejections.add(id);
      else if (PERMANENT_CODES.has(code)) permanentBooks[id] = code;
      else log.warn(`El servidor rechazo un libro con un codigo desconocido (${code}); sigue pendiente.`);
    }
    if (Object.keys(permanentBooks).length > 0) {
      const current = await loadRejectedBooks();
      await meta.set(META_KEYS.syncBookRejections, JSON.stringify({ ...current, ...permanentBooks }));
      log.error(`El servidor rechazo ${Object.keys(permanentBooks).length} libro(s) de forma permanente.`);
    }

    // Sesiones aceptadas (creada, fusionada o duplicada): sincronizadas.
    await sessions.markSessionsSynced(response.sessions.accepted);

    const sessionById = new Map(request.sessions.map((session) => [session.id, session]));
    const toReject: RejectedItem[] = [];
    for (const item of response.sessions.rejected) {
      const bookId = sessionById.get(item.id)?.book_id;
      const waitsForBookRetry =
        item.code === "book_rejected" && bookId !== undefined && retryableBookRejections.has(bookId);
      if (RETRYABLE_CODES.has(item.code) || waitsForBookRetry) continue; // sigue pendiente
      if (PERMANENT_CODES.has(item.code)) toReject.push(item);
      else log.warn(`El servidor rechazo una sesion con un codigo desconocido (${item.code}); sigue pendiente.`);
    }
    await sessions.markSessionsRejected(toReject);
    rejectedSessions.push(...toReject);
  }

  async function runOnce(): Promise<SyncResult> {
    if (!api.isConfigured) return { ...EMPTY, status: "not_configured" };

    const pending = await guardStorage(collect);
    if (pending.books.length === 0 && pending.sessions.length === 0) return EMPTY;

    const requests = planRequests(pending.books, pending.sessions);
    const rejectedSessions: RejectedItem[] = [];
    let sentBooks = 0;
    let sentSessions = 0;
    let lastStreak: ServerStreak | null = null;

    for (const request of requests) {
      let response: ParsedSyncResponse;
      try {
        response = await post(buildSyncBatch(request.books, request.sessions));
      } catch (error) {
        const done = sentBooks > 0 || sentSessions > 0;
        const cause: SyncCause =
          error instanceof ApiError && (error.kind === "network" || error.kind === "timeout") ? "network" : "http";
        const base = { ...EMPTY, sentBooks, sentSessions, rejectedSessions, cause };
        if (error instanceof ApiError) {
          if (error.status === 401) return { ...base, status: "unauthorized" };
          if (!error.retryable) {
            log.error(`El servidor rechazo el lote de sincronizacion (codigo ${error.status ?? "ninguno"}).`);
            return { ...base, status: "failed" };
          }
        }
        return { ...base, status: done ? "partial" : "retry_later" };
      }
      await guardStorage(() => applyResponse(request, response, rejectedSessions));
      sentBooks += request.books.length;
      sentSessions += request.sessions.length;
      if (response.streak) lastStreak = response.streak;
    }

    // Racha del servidor: solo si no queda nada pendiente (un valor parcial pisaria la local).
    const left = await guardStorage(collect);
    let streak: number | null = null;
    if (lastStreak && left.sessions.length === 0) {
      const today = formatLocalWallClock(clock.now()).slice(0, 10);
      streak = effectiveStreak(lastStreak.current, lastStreak.last_valid_session_date, today);
      await meta.set(META_KEYS.streakCurrent, streak);
    }
    return { status: "synced", cause: null, sentBooks, sentSessions, rejectedSessions, streak };
  }

  async function runLoop(): Promise<SyncResult> {
    let result: SyncResult;
    do {
      rerun = false;
      result = await runOnce();
      // Se pidio otro envio mientras corria este (por ejemplo, una sesion nueva): una vuelta mas.
    } while (rerun && (result.status === "synced" || result.status === "nothing"));
    return result;
  }

  /** Llamadas simultaneas comparten una sola corrida; si llega una nueva, se encadena otra vuelta. */
  function flush(): Promise<SyncResult> {
    if (inFlight) {
      rerun = true;
      return inFlight;
    }
    inFlight = runLoop().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  /**
   * Para abrir el chat (SRS 17.20: el servidor exige la sesion). Verdadero solo si ESTA sesion ya
   * esta en el servidor: sincronizada y sin rechazo. Sin red, falso.
   */
  async function isSessionOnServer(sessionId: string): Promise<boolean> {
    return (await sessionGate(sessionId)).state === "ready";
  }

  /**
   * Sincroniza y dice por que se puede o no abrir el chat: la sesion ya esta aceptada (`ready`),
   * no hay conexion (`offline`), no se pudo sincronizar ahora (`unsynced`, reintentable) o el
   * servidor la invalida (`rejected`, permanente). El codigo del rechazo va solo al registro.
   */
  async function sessionGate(sessionId: string): Promise<SessionGate> {
    const result = await flush();
    const session = await sessions.getSession(sessionId);
    if (session === undefined) return { state: "unsynced" };
    if (session.sync_rejection !== null) {
      log.warn(`El servidor no valido la sesion (codigo ${session.sync_rejection}); no se abre el chat.`);
      return { state: "rejected", code: session.sync_rejection };
    }
    if (session.pending_sync === 0) return { state: "ready" };

    // Un libro rechazado de forma permanente nunca envia sus sesiones: tambien es un rechazo.
    const bookCode = (await loadRejectedBooks())[session.book_id];
    if (bookCode !== undefined) {
      log.warn(`El servidor rechazo el libro de la sesion (codigo ${bookCode}); no se abre el chat.`);
      return { state: "rejected", code: bookCode };
    }
    const offline =
      result.status === "not_configured" ||
      ((result.status === "retry_later" || result.status === "partial") && result.cause === "network");
    return { state: offline ? "offline" : "unsynced" };
  }

  return { flush, isSessionOnServer, sessionGate };
}

export type SyncService = ReturnType<typeof createSyncService>;

/** Reintenta al abrir la app y cada vez que vuelve la red. Devuelve la funcion que lo detiene. */
export function watchSync(
  sync: Pick<SyncService, "flush">,
  target: Pick<Window, "addEventListener" | "removeEventListener">,
  onResult?: (result: SyncResult) => void,
): () => void {
  const attempt = () => {
    sync
      .flush()
      .then((result) => onResult?.(result))
      .catch(() => {
        // Fallo de almacenamiento: la cola sigue en Dexie y se reintenta en el proximo evento.
      });
  };
  target.addEventListener("online", attempt);
  attempt();
  return () => target.removeEventListener("online", attempt);
}
