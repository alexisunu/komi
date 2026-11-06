// Servicio de la charla (bloque 7): Dexie real, cliente HTTP real y servidor falso con SSE.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLocalReflectionRepository } from "../data/local_db/localReflectionRepository";
import type { KomiDatabase } from "../data/local_db/dexieDatabase";
import { createApiClient } from "../data/network/apiClient";
import { createCompanionClient, type CompanionChat } from "../data/network/companionClient";
import { createFakeServer, type FakeServer } from "../test/fakeCompanionServer";
import { createTestDb, fakeClock, uuid } from "../test/db";
import type { SessionGate } from "../data/network/syncService";
import { REPLY_IN_PROGRESS_WAIT_MS, createCompanionService, type CompanionService } from "./companionService";

const PROFILE = uuid(77);
const SESSION = uuid(10);
const BOOK = uuid(1);
const READY: SessionGate = { state: "ready" };
const TARGET = { sessionId: SESSION, bookId: BOOK };

let db: KomiDatabase;
let server: FakeServer;
let onServer: boolean;
let service: CompanionService;
const waits: number[] = [];
let onWait: (() => void) | null = null;
const flush = vi.fn(async () => {});

beforeEach(() => {
  db = createTestDb();
  server = createFakeServer({ profileId: PROFILE });
  server.knowSession(SESSION);
  onServer = true;
  waits.length = 0;
  onWait = null;
  flush.mockClear();
  const api = createApiClient({
    baseUrl: "https://api.komi.test",
    fetchFn: server.fetchFn,
    getProfileId: () => PROFILE,
  });
  service = createCompanionService({
    client: createCompanionClient(api),
    sync: { sessionGate: async (): Promise<SessionGate> => (onServer ? READY : { state: "offline" }), flush },
    reflections: createLocalReflectionRepository(db, fakeClock()),
    wait: async (ms) => {
      waits.push(ms);
      onWait?.();
    },
  });
});
afterEach(() => db.close());

const stored = () => db.reflections.get(server.chatOf(SESSION)?.chat_id ?? "");
async function openChat(): Promise<CompanionChat> {
  const result = await service.open(TARGET);
  if (result.kind !== "ready") throw new Error(`No abrio: ${result.kind}`);
  return result.chat;
}
const noop = { onChunk: () => {} };

describe("open", () => {
  it("abre la charla con la apertura de Komi y la guarda en reflections", async () => {
    const chat = await openChat();
    expect(chat.turn_count).toBe(1);
    expect(chat.messages).toHaveLength(1);
    expect(await stored()).toMatchObject({
      session_id: SESSION,
      book_id: BOOK,
      turn_count: 1,
      is_closed: false,
      key_takeaway: null,
    });
  });

  it("no guarda los mensajes en Dexie: solo turn_count, is_closed y la semilla", async () => {
    await openChat();
    const row = (await stored()) as unknown as Record<string, unknown>;
    expect(Object.keys(row).sort()).toEqual(
      ["book_id", "chat_id", "is_closed", "key_takeaway", "session_id", "turn_count", "updated_at"].sort(),
    );
  });

  it("si la sesion no esta en el servidor: offline, sin llamar a start/", async () => {
    onServer = false;
    expect(await service.open(TARGET)).toEqual({ kind: "offline" });
    expect(server.startCalls()).toHaveLength(0);
    expect(await db.reflections.count()).toBe(0);
  });

  it("si la puerta falla de forma inesperada: no se pudo sincronizar (no se culpa a internet)", async () => {
    const broken = createCompanionService({
      client: { start: vi.fn(), send: vi.fn() },
      sync: {
        sessionGate: async () => {
          throw new Error("boom");
        },
        flush,
      },
      reflections: createLocalReflectionRepository(db, fakeClock()),
    });
    expect(await broken.open(TARGET)).toEqual({ kind: "unsynced" });
    expect(await broken.gate(SESSION)).toEqual({ state: "unsynced" });
  });

  it.each([
    [{ state: "unsynced" }, { kind: "unsynced" }],
    [{ state: "rejected", code: "below_50_percent" }, { kind: "rejected" }],
    [{ state: "offline" }, { kind: "offline" }],
  ] as const)("la puerta %j da %j y no llama a start/", async (gate, expected) => {
    const start = vi.fn();
    const gated = createCompanionService({
      client: { start, send: vi.fn() },
      sync: { sessionGate: async () => gate as SessionGate, flush },
      reflections: createLocalReflectionRepository(db, fakeClock()),
    });
    expect(await gated.open(TARGET)).toEqual(expected);
    expect(start).not.toHaveBeenCalled();
  });

  it("gate() devuelve el estado de la puerta tal cual, sin el codigo en un mensaje", async () => {
    const gated = createCompanionService({
      client: { start: vi.fn(), send: vi.fn() },
      sync: { sessionGate: async () => ({ state: "rejected", code: "below_50_percent" }), flush },
      reflections: createLocalReflectionRepository(db, fakeClock()),
    });
    expect(await gated.gate(SESSION)).toEqual({ state: "rejected", code: "below_50_percent" });
  });

  it("sin red al llamar a start/: offline", async () => {
    server.fetchFn.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect(await service.open(TARGET)).toEqual({ kind: "offline" });
  });

  it("retoma la charla: la segunda apertura devuelve la misma con sus mensajes", async () => {
    const first = await openChat();
    server.reply({ kind: "ok", chunks: ["Cuéntame más."] });
    await service.send(TARGET, first, "Me gustó", noop);
    const again = await openChat();
    expect(again.chat_id).toBe(first.chat_id);
    expect(again.turn_count).toBe(2);
    expect(again.messages).toHaveLength(3);
    expect(server.chats.size).toBe(1);
  });

  it("404: hace flush y reintenta una vez; si ahora existe, abre", async () => {
    const lateServer = createFakeServer({ profileId: PROFILE });
    const api = createApiClient({
      baseUrl: "https://api.komi.test",
      fetchFn: lateServer.fetchFn,
      getProfileId: () => PROFILE,
    });
    const late = createCompanionService({
      client: createCompanionClient(api),
      sync: {
        sessionGate: async (): Promise<SessionGate> => READY,
        flush: async () => {
          lateServer.knowSession(SESSION);
        },
      },
      reflections: createLocalReflectionRepository(db, fakeClock()),
    });
    const result = await late.open(TARGET);
    expect(result.kind).toBe("ready");
    expect(lateServer.startCalls()).toHaveLength(2);
  });

  it("404 que persiste tras el flush: not_found, con un solo reintento", async () => {
    server.chats.clear();
    const missing = uuid(99);
    const result = await service.open({ sessionId: missing, bookId: BOOK });
    expect(result).toEqual({ kind: "failed", failure: "not_found" });
    expect(flush).toHaveBeenCalledTimes(1);
    expect(server.startCalls()).toHaveLength(2);
  });

  it("409 session_invalid: falla sin reintentar ni hacer flush", async () => {
    server.invalidateSession(SESSION);
    expect(await service.open(TARGET)).toEqual({ kind: "failed", failure: "session_invalid" });
    expect(flush).not.toHaveBeenCalled();
    expect(server.startCalls()).toHaveLength(1);
  });

  it("si Dexie falla al guardar, la charla abre igual", async () => {
    const fragile = createCompanionService({
      client: createCompanionClient(
        createApiClient({ baseUrl: "https://api.komi.test", fetchFn: server.fetchFn, getProfileId: () => PROFILE }),
      ),
      sync: { sessionGate: async (): Promise<SessionGate> => READY, flush },
      reflections: {
        upsert: async () => {
          throw new Error("cuota llena");
        },
      },
    });
    expect((await fragile.open(TARGET)).kind).toBe("ready");
  });
});

describe("send", () => {
  it("un intercambio: manda el turno de Komi, agrega ambos mensajes y sube turn_count", async () => {
    const chat = await openChat();
    server.reply({ kind: "ok", chunks: ["Qué bonito. ", "¿Por qué?"] });
    const chunks: string[] = [];
    const result = await service.send(TARGET, chat, "  Me gustó el final  ", { onChunk: (t) => chunks.push(t) });
    expect(result.kind).toBe("done");
    if (result.kind !== "done") return;
    expect(server.messageCalls()[0]?.body).toEqual({ content: "Me gustó el final", turn: 1 });
    expect(chunks).toEqual(["Qué bonito. ", "¿Por qué?"]);
    expect(result.chat.turn_count).toBe(2);
    expect(result.chat.messages.map((m) => [m.sender, m.turn_number])).toEqual([
      ["KOMI_AI", 1],
      ["USER", 1],
      ["KOMI_AI", 2],
    ]);
    expect(result.chat.messages[2]?.content).toBe("Qué bonito. ¿Por qué?");
    expect(await stored()).toMatchObject({ turn_count: 2, is_closed: false });
  });

  it("la charla completa son 4 envios del lector; al cuarto cierra y guarda la semilla", async () => {
    let chat = await openChat();
    for (let i = 1; i <= 3; i += 1) {
      server.reply({ kind: "ok", chunks: [`Respuesta ${i}`] });
      const result = await service.send(TARGET, chat, `mensaje ${i}`, noop);
      if (result.kind !== "done") throw new Error("no termino");
      chat = result.chat;
      expect(chat.turn_count).toBe(i + 1);
      expect(chat.is_closed).toBe(false);
    }
    server.reply({ kind: "ok", chunks: ["Cierre"], seed: "La lectura es un jardín." });
    const last = await service.send(TARGET, chat, "mensaje 4", noop);
    if (last.kind !== "done") throw new Error("no termino");
    expect(last.chat).toMatchObject({ turn_count: 5, is_closed: true, key_takeaway: "La lectura es un jardín." });
    expect(server.messageCalls()).toHaveLength(4);
    expect(await stored()).toMatchObject({ turn_count: 5, is_closed: true, key_takeaway: "La lectura es un jardín." });
    expect(last.chat.messages).toHaveLength(9);
  });

  it("cerrada sin semilla: queda cerrada con key_takeaway nulo", async () => {
    let chat = await openChat();
    for (let i = 1; i <= 4; i += 1) {
      server.reply({ kind: "ok", chunks: ["Ok"] });
      const result = await service.send(TARGET, chat, `m${i}`, noop);
      if (result.kind !== "done") throw new Error("no termino");
      chat = result.chat;
    }
    expect(await stored()).toMatchObject({ is_closed: true, key_takeaway: null });
  });

  it("con la charla cerrada no hace ninguna peticion", async () => {
    let chat = await openChat();
    for (let i = 1; i <= 4; i += 1) {
      server.reply({ kind: "ok", chunks: ["Ok"] });
      const result = await service.send(TARGET, chat, `m${i}`, noop);
      if (result.kind !== "done") throw new Error("no termino");
      chat = result.chat;
    }
    const before = server.messageCalls().length;
    const result = await service.send(TARGET, chat, "uno más", noop);
    expect(result.kind).toBe("resynced");
    expect(server.messageCalls()).toHaveLength(before);
  });

  it("rechaza vacio y mas de 2000 caracteres sin llamar al servidor; 2000 exactos vale", async () => {
    const chat = await openChat();
    expect(await service.send(TARGET, chat, "   ", noop)).toMatchObject({ kind: "failed", failure: "validation" });
    expect(await service.send(TARGET, chat, "a".repeat(2001), noop)).toMatchObject({
      kind: "failed",
      failure: "validation",
    });
    expect(server.messageCalls()).toHaveLength(0);
    server.reply({ kind: "ok", chunks: ["Ok"] });
    expect((await service.send(TARGET, chat, "a".repeat(2000), noop)).kind).toBe("done");
  });

  it("2000 emojis (4000 unidades UTF-16) valen: el limite cuenta caracteres", async () => {
    const chat = await openChat();
    server.reply({ kind: "ok", chunks: ["Ok"] });
    expect((await service.send(TARGET, chat, "😀".repeat(2000), noop)).kind).toBe("done");
    const chat2 = await openChat();
    expect(await service.send(TARGET, chat2, "😀".repeat(2001), noop)).toMatchObject({ failure: "validation" });
  });

  it("un error no cambia nada: ni el turno, ni Dexie; el mismo turno se puede reenviar", async () => {
    const chat = await openChat();
    server.reply({ kind: "sse_error", code: "unavailable", before: ["parcial"] });
    const failed = await service.send(TARGET, chat, "Hola", noop);
    expect(failed).toEqual({ kind: "failed", failure: "unavailable", retryAfterSec: null });
    expect(await stored()).toMatchObject({ turn_count: 1 });
    server.reply({ kind: "ok", chunks: ["Ahora sí"] });
    const retried = await service.send(TARGET, chat, "Hola", noop);
    expect(retried.kind).toBe("done");
    expect(server.messageCalls().map((c) => (c.body as { turn: number }).turn)).toEqual([1, 1]);
  });

  it("cuota agotada: devuelve retry_after", async () => {
    const chat = await openChat();
    server.reply({ kind: "sse_error", code: "quota_exceeded", retry_after: 30 });
    expect(await service.send(TARGET, chat, "Hola", noop)).toEqual({
      kind: "failed",
      failure: "quota",
      retryAfterSec: 30,
    });
  });

  it("429 y 503 son errores reintentables, no resincronizan", async () => {
    const chat = await openChat();
    server.reply({ kind: "http", status: 503 }, { kind: "http", status: 429 });
    expect(await service.send(TARGET, chat, "Hola", noop)).toMatchObject({ failure: "unavailable" });
    expect(await service.send(TARGET, chat, "Hola", noop)).toMatchObject({ failure: "quota" });
    expect(server.startCalls()).toHaveLength(1);
  });

  it("reply_in_progress: espera y reintenta UNA vez; si pasa, termina bien", async () => {
    const chat = await openChat();
    server.lock(SESSION);
    server.reply({ kind: "ok", chunks: ["Gracias"] });
    // El candado se suelta mientras el servicio espera.
    onWait = () => server.unlock(SESSION);
    const result = await service.send(TARGET, chat, "Hola", noop);
    expect(waits).toEqual([REPLY_IN_PROGRESS_WAIT_MS]);
    expect(result.kind).toBe("done");
    expect(server.messageCalls()).toHaveLength(2);
  });

  it("reply_in_progress persistente: un solo reintento y luego aviso", async () => {
    const chat = await openChat();
    server.lock(SESSION);
    const result = await service.send(TARGET, chat, "Hola", noop);
    expect(result).toEqual({ kind: "failed", failure: "reply_in_progress", retryAfterSec: null });
    expect(server.messageCalls()).toHaveLength(2);
    expect(waits).toEqual([REPLY_IN_PROGRESS_WAIT_MS]);
  });

  it("turn_mismatch: resincroniza con start/ y conserva el mensaje (no entregado)", async () => {
    const stale = await openChat();
    // Otro dispositivo avanzo la charla.
    server.reply({ kind: "ok", chunks: ["Desde otro dispositivo"] });
    await service.send(TARGET, stale, "Mensaje ajeno", noop);
    server.reply({ kind: "ok", chunks: ["No debería usarse"] });
    const result = await service.send(TARGET, stale, "Mi mensaje", noop);
    expect(result.kind).toBe("resynced");
    if (result.kind !== "resynced") return;
    expect(result.chat.turn_count).toBe(2);
    // El mensaje del lector NO esta en el servidor (la charla la avanzo otro dispositivo): se conserva.
    expect(result.delivered).toBe(false);
    expect(result.chat.messages.map((m) => m.content)).not.toContain("Mi mensaje");
    expect(server.pendingReplies()).toBe(1);
  });

  it("respuesta perdida tras guardar: reenviar da turn_mismatch y la resincronizacion trae el intercambio", async () => {
    const chat = await openChat();
    server.reply({ kind: "saved_but_lost", chunks: ["Respuesta guardada"] });
    const lost = await service.send(TARGET, chat, "Hola", noop);
    expect(lost).toMatchObject({ kind: "failed", failure: "interrupted" });
    const retry = await service.send(TARGET, chat, "Hola", noop);
    expect(retry.kind).toBe("resynced");
    if (retry.kind !== "resynced") return;
    expect(retry.delivered).toBe(true);
    expect(retry.chat.turn_count).toBe(2);
    expect(retry.chat.messages.map((m) => m.content)).toContain("Respuesta guardada");
    expect(await stored()).toMatchObject({ turn_count: 2 });
  });

  it("chat_closed del servidor: resincroniza y deja la charla cerrada con su semilla", async () => {
    const chat = await openChat();
    const serverChat = server.chatOf(SESSION);
    if (serverChat) {
      serverChat.turn_count = 5;
      serverChat.is_closed = true;
      serverChat.key_takeaway = "Semilla del otro dispositivo";
    }
    const result = await service.send(TARGET, chat, "Hola", noop);
    expect(result.kind).toBe("resynced");
    if (result.kind !== "resynced") return;
    expect(result.chat).toMatchObject({ is_closed: true, key_takeaway: "Semilla del otro dispositivo" });
    expect(await stored()).toMatchObject({ is_closed: true, key_takeaway: "Semilla del otro dispositivo" });
  });

  it("si la resincronizacion tambien falla, devuelve ese fallo", async () => {
    const chat = await openChat();
    const serverChat = server.chatOf(SESSION);
    if (serverChat) serverChat.turn_count = 3;
    // Primer fetch (message) -> turn_mismatch; segundo (start) -> sin red.
    const original = server.fetchFn.getMockImplementation() as typeof fetch;
    let calls = 0;
    server.fetchFn.mockImplementation(async (input, init) => {
      calls += 1;
      if (calls === 2) throw new TypeError("Failed to fetch");
      return original(input, init);
    });
    const result = await service.send(TARGET, chat, "Hola", noop);
    expect(result).toEqual({ kind: "failed", failure: "offline", retryAfterSec: null });
  });

  it("cancelar durante la espera de reply_in_progress no reintenta", async () => {
    const chat = await openChat();
    server.lock(SESSION);
    const controller = new AbortController();
    const slow = createCompanionService({
      client: createCompanionClient(
        createApiClient({ baseUrl: "https://api.komi.test", fetchFn: server.fetchFn, getProfileId: () => PROFILE }),
      ),
      sync: { sessionGate: async (): Promise<SessionGate> => READY, flush },
      reflections: createLocalReflectionRepository(db, fakeClock()),
      wait: async () => controller.abort(),
    });
    const result = await slow.send(TARGET, chat, "Hola", { signal: controller.signal, onChunk: () => {} });
    expect(result).toMatchObject({ kind: "failed", failure: "aborted" });
    expect(server.messageCalls()).toHaveLength(1);
  });
});
