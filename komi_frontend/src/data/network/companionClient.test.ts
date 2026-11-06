// Cliente SSE de la charla (bloque 7). El cliente HTTP es real; el servidor es falso y habla SSE.

import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeServer, deferred, type FakeServer } from "../../test/fakeCompanionServer";
import { uuid } from "../../test/db";
import { createApiClient } from "./apiClient";
import {
  CompanionError,
  MAX_MESSAGE_CHARS,
  STREAM_TIMEOUT_MS,
  countChars,
  createCompanionClient,
  createSseParser,
  type CompanionFailureKind,
} from "./companionClient";

const PROFILE = uuid(77);
const SESSION = uuid(10);

function setup(server: FakeServer, timeoutMs?: number) {
  const api = createApiClient({
    baseUrl: "https://api.komi.test",
    fetchFn: server.fetchFn,
    getProfileId: () => PROFILE,
    ...(timeoutMs ? { timeoutMs } : {}),
  });
  return createCompanionClient(api);
}

async function startChat(server: FakeServer) {
  server.knowSession(SESSION);
  return setup(server).start(SESSION);
}

async function failureOf(promise: Promise<unknown>): Promise<CompanionError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof CompanionError) return error;
    throw error;
  }
  throw new Error("Se esperaba un CompanionError");
}

afterEach(() => {
  vi.useRealTimers();
});

describe("createSseParser", () => {
  it("entrega un bloque cuando llega la linea en blanco, aunque venga partido", () => {
    const parser = createSseParser();
    expect(parser.push('event: chunk\ndata: {"te')).toEqual([]);
    expect(parser.push('xt":"hola"}\n')).toEqual([]);
    expect(parser.push("\n")).toEqual([{ event: "chunk", data: '{"text":"hola"}' }]);
  });

  it("acepta CRLF, comentarios y varias lineas data", () => {
    const parser = createSseParser();
    const blocks = parser.push(": ping\r\n\r\nevent: done\r\ndata: a\r\ndata: b\r\n\r\n");
    expect(blocks).toEqual([{ event: "done", data: "a\nb" }]);
  });

  it("separa varios eventos de una sola lectura", () => {
    const blocks = createSseParser().push('event: chunk\ndata: {"text":"a"}\n\nevent: chunk\ndata: {"text":"b"}\n\n');
    expect(blocks.map((block) => block.data)).toEqual(['{"text":"a"}', '{"text":"b"}']);
  });
});

describe("countChars", () => {
  it("cuenta puntos de codigo como el servidor, no unidades UTF-16", () => {
    expect(countChars("a".repeat(2000))).toBe(2000);
    expect(countChars("😀".repeat(2000))).toBe(2000);
    expect("😀".repeat(2000).length).toBe(4000);
  });
});

describe("start", () => {
  it("devuelve la charla con la apertura de Komi", async () => {
    const server = createFakeServer();
    const chat = await startChat(server);
    expect(chat).toMatchObject({ session_id: SESSION, turn_count: 1, is_closed: false, key_takeaway: null });
    expect(chat.messages).toHaveLength(1);
    expect(chat.messages[0]).toMatchObject({ sender: "KOMI_AI", turn_number: 1 });
  });

  it("es idempotente: la segunda llamada devuelve la misma charla", async () => {
    const server = createFakeServer();
    const first = await startChat(server);
    const second = await setup(server).start(SESSION);
    expect(second.chat_id).toBe(first.chat_id);
    expect(server.chats.size).toBe(1);
  });

  it("manda el perfil en la cabecera y el session_id en el cuerpo", async () => {
    const server = createFakeServer({ profileId: PROFILE });
    await startChat(server);
    expect(server.startCalls()[0]?.headers["X-Profile-Id"]).toBe(PROFILE);
    expect(server.startCalls()[0]?.body).toEqual({ session_id: SESSION });
  });

  it("404 -> not_found; 409 session_invalid -> session_invalid; sin red -> offline", async () => {
    const server = createFakeServer();
    expect((await failureOf(setup(server).start(SESSION))).kind).toBe("not_found");
    server.knowSession(SESSION);
    server.invalidateSession(SESSION);
    expect((await failureOf(setup(server).start(SESSION))).kind).toBe("session_invalid");
    const down = createFakeServer();
    down.fetchFn.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect((await failureOf(setup(down).start(SESSION))).kind).toBe("offline");
  });

  it("una respuesta con otra forma es invalid_response", async () => {
    const server = createFakeServer();
    server.fetchFn.mockResolvedValueOnce(new Response(JSON.stringify({ hola: 1 }), { status: 200 }));
    expect((await failureOf(setup(server).start(SESSION))).kind).toBe("invalid_response");
  });
});

describe("send: flujo SSE", () => {
  it("entrega los fragmentos en orden y termina con done", async () => {
    const server = createFakeServer({ profileId: PROFILE });
    const chat = await startChat(server);
    server.reply({ kind: "ok", chunks: ["Hola ", "lector", ", gracias."] });
    const seen: string[] = [];
    const done = await setup(server).send({
      chatId: chat.chat_id,
      content: "Me gustó el final",
      turn: 1,
      onChunk: (text) => seen.push(text),
    });
    expect(seen).toEqual(["Hola ", "lector", ", gracias."]);
    expect(done).toEqual({ turn: 2, is_closed: false, key_takeaway: null, content: "Hola lector, gracias." });
  });

  it("pide text/event-stream, manda perfil, contenido y turno", async () => {
    const server = createFakeServer({ profileId: PROFILE });
    const chat = await startChat(server);
    server.reply({ kind: "ok", chunks: ["ok"] });
    await setup(server).send({ chatId: chat.chat_id, content: "Hola", turn: 1, onChunk: () => {} });
    const call = server.messageCalls()[0];
    expect(call?.headers.Accept).toBe("text/event-stream");
    expect(call?.headers["X-Profile-Id"]).toBe(PROFILE);
    expect(call?.body).toEqual({ content: "Hola", turn: 1 });
  });

  it("reconstruye texto aunque los bytes lleguen de a 3 y partan caracteres de varios bytes", async () => {
    const server = createFakeServer();
    const chat = await startChat(server);
    server.reply({ kind: "ok", chunks: ["Señor ", "mañana: 日本語 ", "fin"], byteSplit: 3 });
    const seen: string[] = [];
    const done = await setup(server).send({
      chatId: chat.chat_id,
      content: "Hola",
      turn: 1,
      onChunk: (text) => seen.push(text),
    });
    expect(seen.join("")).toBe("Señor mañana: 日本語 fin");
    expect(done.content).toBe("Señor mañana: 日本語 fin");
  });

  it("el turno 5 trae la semilla y cierra la charla", async () => {
    const server = createFakeServer();
    const chat = await startChat(server);
    const client = setup(server);
    for (let turn = 1; turn <= 3; turn += 1) {
      server.reply({ kind: "ok", chunks: ["Sigamos."] });
      await client.send({ chatId: chat.chat_id, content: `m${turn}`, turn, onChunk: () => {} });
    }
    server.reply({ kind: "ok", chunks: ["Cierre."], seed: "Leer es volver a casa." });
    const done = await client.send({ chatId: chat.chat_id, content: "m4", turn: 4, onChunk: () => {} });
    expect(done).toEqual({ turn: 5, is_closed: true, key_takeaway: "Leer es volver a casa.", content: "Cierre." });
  });

  it("lee el cuerpo como stream: el primer fragmento llega antes de que termine la respuesta", async () => {
    const server = createFakeServer();
    const chat = await startChat(server);
    const hold = deferred();
    server.reply({ kind: "ok", chunks: ["Primero", " y despues"], hold });
    const seen: string[] = [];
    const pending = setup(server).send({
      chatId: chat.chat_id,
      content: "Hola",
      turn: 1,
      onChunk: (text) => seen.push(text),
    });
    await vi.waitFor(() => expect(seen).toEqual(["Primero"]));
    hold.resolve();
    expect((await pending).content).toBe("Primero y despues");
  });
});

describe("send: errores", () => {
  const cases: Array<[string, Parameters<FakeServer["reply"]>[0], CompanionFailureKind]> = [
    ["error truncated", { kind: "sse_error", code: "truncated" }, "truncated"],
    ["error unavailable", { kind: "sse_error", code: "unavailable" }, "unavailable"],
    ["error internal", { kind: "sse_error", code: "internal" }, "unavailable"],
    ["error conflict", { kind: "sse_error", code: "conflict" }, "unavailable"],
    ["error timeout del servidor", { kind: "sse_error", code: "timeout" }, "timeout"],
    ["codigo de error desconocido", { kind: "sse_error", code: "algo_nuevo" }, "unavailable"],
    ["HTTP 404", { kind: "http", status: 404 }, "not_found"],
    ["HTTP 400", { kind: "http", status: 400 }, "validation"],
    ["HTTP 409 chat_closed", { kind: "http", status: 409, code: "chat_closed" }, "chat_closed"],
    ["HTTP 409 reply_in_progress", { kind: "http", status: 409, code: "reply_in_progress" }, "reply_in_progress"],
    ["HTTP 409 turn_mismatch", { kind: "http", status: 409, code: "turn_mismatch" }, "turn_mismatch"],
    ["HTTP 409 session_invalid", { kind: "http", status: 409, code: "session_invalid" }, "session_invalid"],
    ["HTTP 409 sin codigo", { kind: "http", status: 409 }, "unavailable"],
    ["HTTP 503", { kind: "http", status: 503 }, "unavailable"],
    ["HTTP 500", { kind: "http", status: 500 }, "unavailable"],
    ["sin conexion", { kind: "network" }, "offline"],
    ["stream cortado sin done", { kind: "cut", before: ["parcial"] }, "interrupted"],
  ];

  for (const [name, reply, kind] of cases) {
    it(`${name} -> ${kind}`, async () => {
      const server = createFakeServer();
      const chat = await startChat(server);
      server.reply(reply);
      const error = await failureOf(
        setup(server).send({ chatId: chat.chat_id, content: "Hola", turn: 1, onChunk: () => {} }),
      );
      expect(error.kind).toBe(kind);
    });
  }

  it("quota_exceeded lleva retry_after; HTTP 429 lee Retry-After", async () => {
    const server = createFakeServer();
    const chat = await startChat(server);
    const client = setup(server);
    server.reply({ kind: "sse_error", code: "quota_exceeded", retry_after: 42.2 });
    const viaEvent = await failureOf(client.send({ chatId: chat.chat_id, content: "a", turn: 1, onChunk: () => {} }));
    expect(viaEvent).toMatchObject({ kind: "quota", retryAfterSec: 43 });
    server.reply({ kind: "http", status: 429, headers: { "Retry-After": "30" } });
    const viaHttp = await failureOf(client.send({ chatId: chat.chat_id, content: "a", turn: 1, onChunk: () => {} }));
    expect(viaHttp).toMatchObject({ kind: "quota", retryAfterSec: 30 });
    server.reply({ kind: "sse_error", code: "quota_exceeded" });
    const without = await failureOf(client.send({ chatId: chat.chat_id, content: "a", turn: 1, onChunk: () => {} }));
    expect(without).toMatchObject({ kind: "quota", retryAfterSec: null });
  });

  it("tras un error el servidor no guardo nada: el mismo turno se puede reenviar", async () => {
    const server = createFakeServer();
    const chat = await startChat(server);
    const client = setup(server);
    server.reply({ kind: "sse_error", code: "unavailable", before: ["texto parcial"] });
    await failureOf(client.send({ chatId: chat.chat_id, content: "Hola", turn: 1, onChunk: () => {} }));
    expect(server.chatOf(SESSION)).toMatchObject({ turn_count: 1 });
    server.reply({ kind: "ok", chunks: ["Ahora si"] });
    const done = await client.send({ chatId: chat.chat_id, content: "Hola", turn: 1, onChunk: () => {} });
    expect(done.turn).toBe(2);
  });

  it("un evento con JSON roto es invalid_response", async () => {
    const server = createFakeServer();
    const chat = await startChat(server);
    server.fetchFn.mockResolvedValueOnce(
      new Response("event: chunk\ndata: {no es json\n\n", {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    );
    const error = await failureOf(
      setup(server).send({ chatId: chat.chat_id, content: "Hola", turn: 1, onChunk: () => {} }),
    );
    expect(error.kind).toBe("invalid_response");
  });

  it("un chunk sin texto es invalid_response", async () => {
    const server = createFakeServer();
    const chat = await startChat(server);
    server.fetchFn.mockResolvedValueOnce(
      new Response('event: chunk\ndata: {"x":1}\n\n', { status: 200 }),
    );
    const error = await failureOf(
      setup(server).send({ chatId: chat.chat_id, content: "Hola", turn: 1, onChunk: () => {} }),
    );
    expect(error.kind).toBe("invalid_response");
  });

  it("ignora eventos desconocidos y comentarios keep-alive", async () => {
    const server = createFakeServer();
    const chat = await startChat(server);
    server.fetchFn.mockResolvedValueOnce(
      new Response(
        ': keep-alive\n\nevent: ping\ndata: {}\n\nevent: chunk\ndata: {"text":"ok"}\n\n' +
          'event: done\ndata: {"turn":2,"is_closed":false,"key_takeaway":null,"content":"ok"}\n\n',
        { status: 200 },
      ),
    );
    const seen: string[] = [];
    const done = await setup(server).send({
      chatId: chat.chat_id,
      content: "Hola",
      turn: 1,
      onChunk: (text) => seen.push(text),
    });
    expect(seen).toEqual(["ok"]);
    expect(done.turn).toBe(2);
  });
});

describe("send: cancelacion y tiempo maximo", () => {
  it("cancelar con la signal corta el stream, lanza aborted y avisa al servidor", async () => {
    const server = createFakeServer();
    const chat = await startChat(server);
    server.reply({ kind: "hang", before: ["Empiezo"] });
    const controller = new AbortController();
    const seen: string[] = [];
    const pending = setup(server).send({
      chatId: chat.chat_id,
      content: "Hola",
      turn: 1,
      signal: controller.signal,
      onChunk: (text) => seen.push(text),
    });
    const outcome = failureOf(pending);
    await vi.waitFor(() => expect(seen).toEqual(["Empiezo"]));
    controller.abort();
    expect((await outcome).kind).toBe("aborted");
    await vi.waitFor(() => expect(server.state.cancelled).toBeGreaterThan(0));
  });

  it("una signal ya cancelada no llega a enviar la peticion", async () => {
    const server = createFakeServer();
    const chat = await startChat(server);
    const controller = new AbortController();
    controller.abort();
    const error = await failureOf(
      setup(server).send({ chatId: chat.chat_id, content: "Hola", turn: 1, signal: controller.signal, onChunk: () => {} }),
    );
    expect(error.kind).toBe("aborted");
    expect(server.messageCalls().length).toBeLessThanOrEqual(1);
  });

  it("a los 60 s sin terminar lanza timeout y suelta la conexion", async () => {
    const server = createFakeServer();
    const chat = await startChat(server);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    server.reply({ kind: "hang", before: ["parcial"] });
    const seen: string[] = [];
    const outcome = failureOf(
      setup(server).send({ chatId: chat.chat_id, content: "Hola", turn: 1, onChunk: (text) => seen.push(text) }),
    );
    await vi.advanceTimersByTimeAsync(STREAM_TIMEOUT_MS - 1);
    expect(seen.length).toBeLessThanOrEqual(1);
    let settled = false;
    void outcome.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect((await outcome).kind).toBe("timeout");
    expect(server.state.cancelled).toBeGreaterThan(0);
  });

  it("el tiempo maximo es de 60 s", () => {
    expect(STREAM_TIMEOUT_MS).toBe(60_000);
    expect(MAX_MESSAGE_CHARS).toBe(2000);
  });

  it("al terminar bien no queda ningun temporizador pendiente", async () => {
    const server = createFakeServer();
    const chat = await startChat(server);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    server.reply({ kind: "ok", chunks: ["Hola"] });
    const pending = setup(server).send({ chatId: chat.chat_id, content: "Hola", turn: 1, onChunk: () => {} });
    await vi.advanceTimersByTimeAsync(5);
    await pending;
    expect(vi.getTimerCount()).toBe(0);
  });
});
