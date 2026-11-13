import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeStreak } from "../../services/localStreak";
import { createTestDb, fakeClock, uuid, type FakeClock } from "../../test/db";
import type { KomiDatabase } from "../local_db/dexieDatabase";
import { createLocalBookRepository, type LocalBookRepository } from "../local_db/localBookRepository";
import { createLocalMetaRepository, META_KEYS } from "../local_db/localMetaRepository";
import {
  createLocalSessionRepository,
  type LocalSessionRepository,
} from "../local_db/localSessionRepository";
import type { LocalBook, LocalSession } from "../local_db/types";
import { createApiClient } from "./apiClient";
import {
  createSyncService,
  MAX_BOOKS_PER_REQUEST,
  MAX_SESSIONS_PER_REQUEST,
  parseSyncResponse,
  planRequests,
  SYNC_PATH,
  watchSync,
} from "./syncService";

const PROFILE = uuid(900);

let db: KomiDatabase;
let clock: FakeClock;
let books: LocalBookRepository;
let sessions: LocalSessionRepository;
let meta: ReturnType<typeof createLocalMetaRepository>;
const log = { warn: vi.fn(), error: vi.fn() };

beforeEach(() => {
  db = createTestDb();
  clock = fakeClock("2026-11-05T22:00:00.000Z");
  books = createLocalBookRepository(db, clock);
  sessions = createLocalSessionRepository(db, clock);
  meta = createLocalMetaRepository(db);
  log.warn.mockClear();
  log.error.mockClear();
});
afterEach(() => db.close());

interface Batch {
  books: Array<{ id: string }>;
  sessions: Array<{ id: string; book_id: string; extracted_epub_excerpt?: string }>;
}
interface Rule {
  rejectBooks?: Record<string, string>;
  rejectSessions?: Record<string, string>;
  streak?: { current: number; longest: number; last_valid_session_date: string | null } | null;
}

/** Servidor falso: acepta todo salvo lo que la regla rechaza. */
function fakeServer(rule: Rule | ((batch: Batch, call: number) => Rule | Response) = {}) {
  let call = 0;
  const bodies: Batch[] = [];
  const headers: Array<Record<string, string>> = [];
  const fetchFn = vi.fn<typeof fetch>(async (_url, init) => {
    call += 1;
    const batch = JSON.parse(String(init?.body)) as Batch;
    bodies.push(batch);
    headers.push(init?.headers as Record<string, string>);
    const r = typeof rule === "function" ? rule(batch, call) : rule;
    if (r instanceof Response) return r;
    const body = {
      books: {
        accepted: batch.books.filter((b) => !r.rejectBooks?.[b.id]).map((b) => ({ id: b.id, result: "created" })),
        rejected: batch.books
          .filter((b) => r.rejectBooks?.[b.id])
          .map((b, index) => ({ index, id: b.id, code: r.rejectBooks?.[b.id], detail: "x" })),
      },
      sessions: {
        accepted: batch.sessions
          .filter((s) => !r.rejectSessions?.[s.id])
          .map((s) => ({ id: s.id, result: "created", session_status: "COMPLETED" })),
        rejected: batch.sessions
          .filter((s) => r.rejectSessions?.[s.id])
          .map((s, index) => ({ index, id: s.id, code: r.rejectSessions?.[s.id], detail: "x" })),
      },
      server_books: [],
      streak:
        r.streak === undefined
          ? { current: 2, longest: 2, last_valid_session_date: "2026-11-05" }
          : r.streak,
    };
    return new Response(JSON.stringify(body), { status: 200 });
  });
  return { fetchFn, bodies, headers, calls: () => call };
}

function serviceWith(
  fetchFn: ReturnType<typeof fakeServer>["fetchFn"],
  extra: { baseUrl?: string | null; recoverUnauthorized?: () => Promise<boolean>; timeoutMs?: number } = {},
) {
  const api = createApiClient({
    baseUrl: extra.baseUrl === undefined ? "https://api.komi.test" : extra.baseUrl,
    fetchFn,
    getProfileId: () => PROFILE,
    ...(extra.timeoutMs === undefined ? {} : { timeoutMs: extra.timeoutMs }),
  });
  return createSyncService({
    db,
    api,
    clock,
    log,
    ...(extra.recoverUnauthorized ? { recoverUnauthorized: extra.recoverUnauthorized } : {}),
  });
}

let counter = 0;
async function book(markSynced = false): Promise<LocalBook> {
  counter += 1;
  const created = await books.createBook({
    id: uuid(100 + counter),
    title: `Libro ${counter}`,
    author: "Autora",
    format_type: "PHYSICAL",
    total_pages: 200,
  });
  if (markSynced) await books.markBooksSynced([{ id: created.id, updated_at: created.updated_at }]);
  return created;
}

async function addSession(bookId: string, overrides: Partial<LocalSession> = {}): Promise<LocalSession> {
  counter += 1;
  const row: LocalSession = {
    id: uuid(1000 + counter),
    book_id: bookId,
    planned_duration_sec: 900,
    actual_duration_sec: 900,
    started_at_local: "2026-11-05T21:30:00",
    session_status: "COMPLETED",
    current_page: 30,
    progress_percentage: null,
    last_epub_cfi: null,
    extracted_epub_excerpt: null,
    progress_delta: 15,
    granted_solar_bonus: false,
    pending_sync: 1,
    sync_rejection: null,
    ...overrides,
  };
  await db.sessions.add(row);
  return row;
}

describe("flush: casos simples", () => {
  it("sin nada pendiente no hace ninguna peticion", async () => {
    const server = fakeServer();
    const result = await serviceWith(server.fetchFn).flush();
    expect(result.status).toBe("nothing");
    expect(server.fetchFn).not.toHaveBeenCalled();
  });

  it("sin servidor configurado no sale nada del dispositivo", async () => {
    await book();
    const server = fakeServer();
    const result = await serviceWith(server.fetchFn, { baseUrl: null }).flush();
    expect(result.status).toBe("not_configured");
    expect(server.fetchFn).not.toHaveBeenCalled();
    expect((await books.listPendingBooks()).length).toBe(1);
  });

  it("envia libro y sesion con la cabecera del perfil y los deja sincronizados", async () => {
    const b = await book();
    const s = await addSession(b.id, { extracted_epub_excerpt: "texto leido" });
    const server = fakeServer();
    const result = await serviceWith(server.fetchFn).flush();

    expect(result).toMatchObject({ status: "synced", sentBooks: 1, sentSessions: 1, rejectedSessions: [] });
    const [url, init] = server.fetchFn.mock.calls[0] ?? [];
    expect(String(url)).toBe(`https://api.komi.test/api/v1${SYNC_PATH}`);
    expect(init?.method).toBe("POST");
    expect(server.headers[0]?.["X-Profile-Id"]).toBe(PROFILE);
    expect(server.bodies[0]?.books.map((x) => x.id)).toEqual([b.id]);
    expect(server.bodies[0]?.sessions[0]).toMatchObject({ id: s.id, extracted_epub_excerpt: "texto leido" });

    expect(await books.listPendingBooks()).toEqual([]);
    expect(await sessions.listPendingSessions()).toEqual([]);
    expect((await sessions.getSession(s.id))?.extracted_epub_excerpt).toBeNull();
  });

  it("incluye el libro de una sesion pendiente aunque el libro ya estuviera sincronizado", async () => {
    const b = await book(true);
    await addSession(b.id);
    const server = fakeServer();
    await serviceWith(server.fetchFn).flush();
    expect(server.bodies[0]?.books.map((x) => x.id)).toEqual([b.id]);
  });

  it("guarda la racha efectiva del servidor cuando no queda nada pendiente", async () => {
    const b = await book();
    await addSession(b.id);
    const server = fakeServer({ streak: { current: 3, longest: 5, last_valid_session_date: "2026-11-05" } });
    const result = await serviceWith(server.fetchFn).flush();
    expect(result.streak).toBe(3);
    expect(await meta.getStreakCurrent()).toBe(3);
  });

  it("si el servidor informa una racha vieja, se guarda la efectiva (0 tras dos dias sin leer)", async () => {
    const b = await book();
    await addSession(b.id);
    const server = fakeServer({ streak: { current: 4, longest: 4, last_valid_session_date: "2026-11-01" } });
    await serviceWith(server.fetchFn).flush();
    expect(await meta.get(META_KEYS.streakCurrent)).toBe(0);
  });

  it("repetir el envio sin cambios no hace otra peticion", async () => {
    const b = await book();
    await addSession(b.id);
    const server = fakeServer();
    const service = serviceWith(server.fetchFn);
    await service.flush();
    await service.flush();
    expect(server.calls()).toBe(1);
  });
});

describe("flush: rechazos del servidor", () => {
  it("un rechazo permanente NO borra la sesion: la marca, la saca de la cola y no cuenta en la racha", async () => {
    const b = await book();
    const good = await addSession(b.id, { started_at_local: "2026-11-04T21:00:00" });
    const bad = await addSession(b.id, { started_at_local: "2026-11-05T21:00:00" });
    const server = fakeServer({ rejectSessions: { [bad.id]: "duration_out_of_range" } });
    const service = serviceWith(server.fetchFn);
    const result = await service.flush();

    expect(result.rejectedSessions).toEqual([{ id: bad.id, code: "duration_out_of_range" }]);
    const kept = await sessions.getSession(bad.id);
    expect(kept).toMatchObject({ sync_rejection: "duration_out_of_range", pending_sync: 0 });
    expect(kept?.actual_duration_sec).toBe(900); // los datos del lector siguen ahi
    expect((await sessions.getSession(good.id))?.sync_rejection).toBeNull();

    const all = await db.sessions.toArray();
    expect(computeStreak(all, "2026-11-05")).toMatchObject({ current: 1, last_date: "2026-11-04" });

    await service.flush(); // no se reenvia
    expect(server.calls()).toBe(1);
  });

  it("duration_out_of_range no bloquea la cola: las demas del lote se sincronizan y la rechazada no se reintenta", async () => {
    const b = await book();
    const before = await addSession(b.id, { started_at_local: "2026-11-03T21:00:00" });
    const short = await addSession(b.id, { started_at_local: "2026-11-04T21:00:00", actual_duration_sec: 120 });
    const after = await addSession(b.id, { started_at_local: "2026-11-05T21:00:00" });
    const server = fakeServer({ rejectSessions: { [short.id]: "duration_out_of_range" } });
    const service = serviceWith(server.fetchFn);

    const result = await service.flush();
    expect(result.status).toBe("synced");
    expect(result.rejectedSessions).toEqual([{ id: short.id, code: "duration_out_of_range" }]);
    expect(await sessions.getSession(short.id)).toMatchObject({
      sync_rejection: "duration_out_of_range",
      pending_sync: 0,
    });
    expect((await sessions.getSession(before.id))?.pending_sync).toBe(0);
    expect((await sessions.getSession(after.id))?.pending_sync).toBe(0);
    expect((await sessions.listPendingSessions()).length).toBe(0);

    const again = await service.flush(); // nada pendiente: no se reenvia la rechazada
    expect(again.status).toBe("nothing");
    expect(server.calls()).toBe(1);

    const later = await addSession(b.id, { started_at_local: "2026-11-06T21:00:00" });
    await service.flush(); // una sesion nueva se envia sin arrastrar a la rechazada
    expect((await sessions.getSession(later.id))?.pending_sync).toBe(0);
    expect(server.calls()).toBe(2);
  });

  it("cada codigo permanente de la tabla marca la sesion", async () => {
    const b = await book();
    const codes = [
      "validation_error",
      "duration_out_of_range",
      "below_50_percent",
      "future_start",
      "book_not_found",
      "id_conflict",
      "duplicate_in_batch",
    ];
    const rows = await Promise.all(codes.map((_, i) => addSession(b.id, { started_at_local: `2026-11-0${i + 1}T10:00:00` })));
    const map = Object.fromEntries(rows.map((r, i) => [r.id, codes[i] as string]));
    await serviceWith(fakeServer({ rejectSessions: map }).fetchFn).flush();
    const stored = await db.sessions.toArray();
    expect(stored.map((s) => s.sync_rejection).sort()).toEqual([...codes].sort());
  });

  it("updated_at_in_future es reintentable: el libro y su sesion siguen pendientes", async () => {
    const b = await book();
    const s = await addSession(b.id);
    const server = fakeServer({
      rejectBooks: { [b.id]: "updated_at_in_future" },
      rejectSessions: { [s.id]: "book_rejected" },
    });
    const service = serviceWith(server.fetchFn);
    const result = await service.flush();
    expect(result.rejectedSessions).toEqual([]);
    expect((await books.listPendingBooks()).map((x) => x.id)).toEqual([b.id]);
    expect((await sessions.listPendingSessions()).map((x) => x.id)).toEqual([s.id]);
    expect((await sessions.getSession(s.id))?.sync_rejection).toBeNull();
    expect(result.streak).toBeNull(); // queda algo pendiente: no se pisa la racha local
  });

  it("un libro rechazado de forma permanente deja de enviarse y su sesion queda marcada", async () => {
    const b = await book();
    const s = await addSession(b.id);
    const server = fakeServer({
      rejectBooks: { [b.id]: "validation_error" },
      rejectSessions: { [s.id]: "book_rejected" },
    });
    const service = serviceWith(server.fetchFn);
    await service.flush();
    expect((await sessions.getSession(s.id))?.sync_rejection).toBe("book_rejected");
    expect(JSON.parse(String(await meta.get(META_KEYS.syncBookRejections)))).toEqual({
      [b.id]: "validation_error",
    });
    expect(log.error).toHaveBeenCalled();

    const s2 = await addSession(b.id, { started_at_local: "2026-11-06T09:00:00" });
    const again = await service.flush();
    expect(again.status).toBe("nothing"); // el libro rechazado y sus sesiones no se reenvian
    expect(server.calls()).toBe(1);
    expect((await sessions.getSession(s2.id))?.pending_sync).toBe(1);
  });

  it("un codigo desconocido no descarta nada: sigue pendiente y se avisa", async () => {
    const b = await book();
    const s = await addSession(b.id);
    await serviceWith(fakeServer({ rejectSessions: { [s.id]: "codigo_nuevo" } }).fetchFn).flush();
    expect((await sessions.getSession(s.id))).toMatchObject({ pending_sync: 1, sync_rejection: null });
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("codigo_nuevo"));
  });
});

describe("flush: fallos de red y de servidor", () => {
  async function pendingSetup() {
    const b = await book();
    const s = await addSession(b.id);
    return { b, s };
  }

  async function expectUntouched(b: LocalBook, s: LocalSession) {
    expect((await books.listPendingBooks()).map((x) => x.id)).toEqual([b.id]);
    expect((await sessions.listPendingSessions()).map((x) => x.id)).toEqual([s.id]);
    expect(await meta.getStreakCurrent()).toBe(0);
  }

  it.each([
    ["sin red", () => Promise.reject(new TypeError("Failed to fetch"))],
    ["503", () => Promise.resolve(new Response("{}", { status: 503 }))],
    ["429", () => Promise.resolve(new Response("{}", { status: 429 }))],
    ["respuesta que no es JSON", () => Promise.resolve(new Response("<html>", { status: 200 }))],
    ["JSON con otra forma", () => Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }))],
  ])("%s: retry_later y no cambia nada", async (_name, respond) => {
    const { b, s } = await pendingSetup();
    const fetchFn = vi.fn<typeof fetch>(respond);
    const result = await serviceWith(fetchFn).flush();
    expect(result.status).toBe("retry_later");
    await expectUntouched(b, s);
  });

  it("400 o 413 de la peticion completa: failed, sin descartar nada", async () => {
    const { b, s } = await pendingSetup();
    for (const status of [400, 413]) {
      const fetchFn = vi.fn<typeof fetch>(async () => new Response("{}", { status }));
      expect((await serviceWith(fetchFn).flush()).status).toBe("failed");
      await expectUntouched(b, s);
    }
  });

  it("401 sin recuperacion: unauthorized", async () => {
    const { b, s } = await pendingSetup();
    const fetchFn = vi.fn<typeof fetch>(async () => new Response("{}", { status: 401 }));
    expect((await serviceWith(fetchFn).flush()).status).toBe("unauthorized");
    await expectUntouched(b, s);
  });

  it("401 con recuperacion: confirma el perfil y reintenta una sola vez", async () => {
    await pendingSetup();
    let first = true;
    const server = fakeServer(() => (first ? new Response("{}", { status: 401 }) : {}));
    const wrapped = vi.fn<typeof fetch>(async (url, init) => {
      const response = await server.fetchFn(url, init);
      first = false;
      return response;
    });
    const recover = vi.fn(async () => true);
    const result = await serviceWith(wrapped, { recoverUnauthorized: recover }).flush();
    expect(recover).toHaveBeenCalledTimes(1);
    expect(wrapped).toHaveBeenCalledTimes(2);
    expect(result.status).toBe("synced");
  });

  it("401 que persiste tras recuperar no entra en bucle", async () => {
    await pendingSetup();
    const fetchFn = vi.fn<typeof fetch>(async () => new Response("{}", { status: 401 }));
    const recover = vi.fn(async () => true);
    const result = await serviceWith(fetchFn, { recoverUnauthorized: recover }).flush();
    expect(result.status).toBe("unauthorized");
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});

describe("flush: una corrida a la vez", () => {
  it("dos llamadas simultaneas comparten una sola peticion", async () => {
    const b = await book();
    await addSession(b.id);
    const server = fakeServer();
    const service = serviceWith(server.fetchFn);
    const [a, c] = await Promise.all([service.flush(), service.flush()]);
    expect(a).toBe(c);
    expect(server.calls()).toBe(1);
  });

  it("una sesion nueva que llega durante el envio sale en una segunda vuelta", async () => {
    const b = await book();
    await addSession(b.id);
    const server = fakeServer();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let firstCall = true;
    const slow = vi.fn<typeof fetch>(async (url, init) => {
      if (firstCall) {
        firstCall = false;
        await gate;
      }
      return server.fetchFn(url, init);
    });
    const service = serviceWith(slow);
    const running = service.flush();
    await vi.waitFor(() => expect(slow).toHaveBeenCalledTimes(1));
    const late = await addSession(b.id, { started_at_local: "2026-11-06T09:00:00" });
    void service.flush(); // pide otra vuelta
    release?.();
    await running;
    expect(slow).toHaveBeenCalledTimes(2);
    expect((await sessions.getSession(late.id))?.pending_sync).toBe(0);
  });
});

describe("flush por tandas", () => {
  it("si la segunda peticion falla, lo enviado queda marcado, el resto pendiente y la racha intacta", async () => {
    const b = await book();
    for (let i = 0; i < MAX_SESSIONS_PER_REQUEST + 5; i += 1) {
      await addSession(b.id, { started_at_local: `2026-10-${String((i % 28) + 1).padStart(2, "0")}T10:00:${String(i % 60).padStart(2, "0")}` });
    }
    const server = fakeServer((_batch, call) => (call === 2 ? new Response("{}", { status: 503 }) : {}));
    const result = await serviceWith(server.fetchFn).flush();
    expect(result.status).toBe("partial");
    expect(result.sentSessions).toBe(MAX_SESSIONS_PER_REQUEST);
    expect((await sessions.listPendingSessions()).length).toBe(5);
    expect(await meta.getStreakCurrent()).toBe(0);
  });

  it("planRequests: libros primero, de 100 en 100; las sesiones, de 200 en 200", () => {
    const manyBooks = Array.from({ length: 250 }, (_, i) => ({ id: uuid(i + 1) }) as LocalBook);
    const manySessions = Array.from(
      { length: 450 },
      (_, i) => ({ id: uuid(5000 + i), extracted_epub_excerpt: "x" }) as LocalSession,
    );
    const requests = planRequests(manyBooks, manySessions);
    expect(requests.map((r) => [r.books.length, r.sessions.length])).toEqual([
      [MAX_BOOKS_PER_REQUEST, 0],
      [MAX_BOOKS_PER_REQUEST, 0],
      [50, MAX_SESSIONS_PER_REQUEST],
      [0, MAX_SESSIONS_PER_REQUEST],
      [0, 50],
    ]);
    // El extracto solo queda en la sesion mas reciente de cada peticion.
    for (const request of requests.filter((r) => r.sessions.length > 0)) {
      const withExcerpt = request.sessions.filter((s) => s.extracted_epub_excerpt !== null);
      expect(withExcerpt).toEqual([request.sessions[request.sessions.length - 1]]);
    }
  });

  it("planRequests: sin libros las sesiones van solas; sin nada, ninguna peticion", () => {
    expect(planRequests([], [])).toEqual([]);
    const one = [{ id: uuid(1), extracted_epub_excerpt: null }] as LocalSession[];
    expect(planRequests([], one).map((r) => [r.books.length, r.sessions.length])).toEqual([[0, 1]]);
  });
});

describe("isSessionOnServer (puerta del chat)", () => {
  it("verdadero cuando el envio tuvo exito", async () => {
    const b = await book();
    const s = await addSession(b.id);
    expect(await serviceWith(fakeServer().fetchFn).isSessionOnServer(s.id)).toBe(true);
  });

  it("falso sin red: el chat debe mostrar el mensaje de sin conexion", async () => {
    const b = await book();
    const s = await addSession(b.id);
    const fetchFn = vi.fn<typeof fetch>(() => Promise.reject(new TypeError("offline")));
    expect(await serviceWith(fetchFn).isSessionOnServer(s.id)).toBe(false);
  });

  it("falso si el servidor rechazo la sesion de forma permanente", async () => {
    const b = await book();
    const s = await addSession(b.id);
    const server = fakeServer({ rejectSessions: { [s.id]: "future_start" } });
    expect(await serviceWith(server.fetchFn).isSessionOnServer(s.id)).toBe(false);
  });

  it("verdadero si la sesion ya estaba sincronizada aunque ahora no haya red", async () => {
    const b = await book(true);
    const s = await addSession(b.id, { pending_sync: 0 });
    const fetchFn = vi.fn<typeof fetch>(() => Promise.reject(new TypeError("offline")));
    expect(await serviceWith(fetchFn).isSessionOnServer(s.id)).toBe(true);
  });

  it("falso para una sesion que no existe", async () => {
    expect(await serviceWith(fakeServer().fetchFn).isSessionOnServer(uuid(777))).toBe(false);
  });
});

describe("sessionGate (puerta del chat con motivo)", () => {
  async function pending() {
    const b = await book();
    return addSession(b.id);
  }

  it("aceptada por el servidor: ready", async () => {
    const s = await pending();
    expect(await serviceWith(fakeServer().fetchFn).sessionGate(s.id)).toEqual({ state: "ready" });
  });

  it("sin red: offline, y la corrida informa la causa de red", async () => {
    const s = await pending();
    const fetchFn = vi.fn<typeof fetch>(() => Promise.reject(new TypeError("offline")));
    const service = serviceWith(fetchFn);
    expect(await service.sessionGate(s.id)).toEqual({ state: "offline" });
    expect((await service.flush()).cause).toBe("network");
  });

  it("sin servidor configurado: offline", async () => {
    const s = await pending();
    expect(await serviceWith(fakeServer().fetchFn, { baseUrl: null }).sessionGate(s.id)).toEqual({
      state: "offline",
    });
  });

  it("el servidor responde 500: unsynced (no es falta de internet)", async () => {
    const s = await pending();
    const fetchFn = vi.fn<typeof fetch>(async () => new Response("{}", { status: 500 }));
    const service = serviceWith(fetchFn);
    expect(await service.sessionGate(s.id)).toEqual({ state: "unsynced" });
    expect((await service.flush()).cause).toBe("http");
  });

  it("tiempo agotado: cuenta como falta de conexion (offline)", async () => {
    const s = await pending();
    const fetchFn = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("abort", "AbortError")));
        }),
    );
    const service = serviceWith(fetchFn, { timeoutMs: 10 });
    expect(await service.sessionGate(s.id)).toEqual({ state: "offline" });
  });

  it("401 (perfil desconocido): unsynced", async () => {
    const s = await pending();
    const fetchFn = vi.fn<typeof fetch>(async () => new Response("{}", { status: 401 }));
    expect(await serviceWith(fetchFn).sessionGate(s.id)).toEqual({ state: "unsynced" });
  });

  it("4xx del lote completo (400): unsynced", async () => {
    const s = await pending();
    const fetchFn = vi.fn<typeof fetch>(async () => new Response("{}", { status: 400 }));
    expect(await serviceWith(fetchFn).sessionGate(s.id)).toEqual({ state: "unsynced" });
  });

  it("rechazo permanente de la sesion: rejected con su codigo, que solo va al registro", async () => {
    const s = await pending();
    const server = fakeServer({ rejectSessions: { [s.id]: "duration_out_of_range" } });
    log.warn.mockClear();
    expect(await serviceWith(server.fetchFn).sessionGate(s.id)).toEqual({
      state: "rejected",
      code: "duration_out_of_range",
    });
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("duration_out_of_range"));
  });

  it("rechazo reintentable del libro (updated_at_in_future): unsynced, la sesion sigue pendiente", async () => {
    const b = await book();
    const s = await addSession(b.id);
    const server = fakeServer({
      rejectBooks: { [b.id]: "updated_at_in_future" },
      rejectSessions: { [s.id]: "book_rejected" },
    });
    expect(await serviceWith(server.fetchFn).sessionGate(s.id)).toEqual({ state: "unsynced" });
    expect((await db.sessions.get(s.id))?.pending_sync).toBe(1);
  });

  it("libro rechazado antes de forma permanente: rejected, sin enviar nada", async () => {
    const b = await book();
    const s = await addSession(b.id);
    const first = fakeServer({ rejectBooks: { [b.id]: "id_conflict" }, rejectSessions: { [s.id]: "book_rejected" } });
    await serviceWith(first.fetchFn).flush();
    await db.sessions.update(s.id, { sync_rejection: null, pending_sync: 1 });
    const second = fakeServer();
    expect(await serviceWith(second.fetchFn).sessionGate(s.id)).toEqual({ state: "rejected", code: "id_conflict" });
    expect(second.calls()).toBe(0);
  });

  it("sesion ya sincronizada: ready aunque ahora no haya red", async () => {
    const b = await book(true);
    const s = await addSession(b.id, { pending_sync: 0 });
    const fetchFn = vi.fn<typeof fetch>(() => Promise.reject(new TypeError("offline")));
    expect(await serviceWith(fetchFn).sessionGate(s.id)).toEqual({ state: "ready" });
  });

  it("una sesion que no existe: unsynced", async () => {
    expect(await serviceWith(fakeServer().fetchFn).sessionGate(uuid(777))).toEqual({ state: "unsynced" });
  });
});

describe("parseSyncResponse", () => {
  const ok = {
    books: { accepted: [{ id: "a", result: "created" }], rejected: [] },
    sessions: { accepted: [], rejected: [{ index: 0, id: "s", code: "future_start", detail: "x" }] },
    streak: { current: 1, longest: 2, last_valid_session_date: null },
  };

  it("lee las partes que usa el cliente", () => {
    expect(parseSyncResponse(ok)).toEqual({
      books: { accepted: ["a"], rejected: [] },
      sessions: { accepted: [], rejected: [{ id: "s", code: "future_start" }] },
      streak: { current: 1, longest: 2, last_valid_session_date: null },
    });
  });

  it("sin racha valida devuelve null en esa parte, no rompe", () => {
    expect(parseSyncResponse({ ...ok, streak: { current: "x" } })?.streak).toBeNull();
    expect(parseSyncResponse({ ...ok, streak: undefined })?.streak).toBeNull();
  });

  it.each([null, 3, "x", {}, { books: {}, sessions: {} }, { ...ok, books: { accepted: [{}], rejected: [] } }])(
    "forma invalida %#",
    (value) => {
      expect(parseSyncResponse(value)).toBeNull();
    },
  );
});

describe("watchSync", () => {
  it("intenta al empezar y al volver la red, y deja de escuchar al detenerse", async () => {
    const flush = vi.fn(async () => ({
      cause: null,
      status: "nothing" as const,
      sentBooks: 0,
      sentSessions: 0,
      rejectedSessions: [],
      streak: null,
    }));
    const handlers = new Map<string, () => void>();
    const target = {
      addEventListener: (name: string, fn: () => void) => handlers.set(name, fn),
      removeEventListener: (name: string) => handlers.delete(name),
    };
    const onResult = vi.fn();
    const stop = watchSync({ flush }, target as never, onResult);
    expect(flush).toHaveBeenCalledTimes(1);
    handlers.get("online")?.();
    expect(flush).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(onResult).toHaveBeenCalledTimes(2));
    stop();
    expect(handlers.has("online")).toBe(false);
  });
});
