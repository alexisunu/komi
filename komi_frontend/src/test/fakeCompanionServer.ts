// Servidor falso del backend para la charla con Komi y la sincronizacion (sin red, sin Gemini).
// Imita las reglas de apps/ai_companion: 404, 400, 409 (chat_closed, reply_in_progress,
// turn_mismatch, session_invalid), el SSE con chunk/done/error y el guardado atomico (un error NO
// guarda nada). Cada prueba programa las respuestas de los mensajes con `script`.

import { vi } from "vitest";

export interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

export function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

export type Reply =
  /** Responde bien. `hold` detiene el stream tras el primer fragmento hasta que se resuelva. */
  | { kind: "ok"; chunks: string[]; seed?: string | null; hold?: Deferred; byteSplit?: number }
  /** Un `error` dentro del 200 (con fragmentos parciales antes, que el cliente debe descartar). */
  | { kind: "sse_error"; code: string; retry_after?: number | null; before?: string[] }
  /** Error previo al stream (JSON). */
  | { kind: "http"; status: number; code?: string; headers?: Record<string, string> }
  /** fetch rechaza (sin conexion). */
  | { kind: "network" }
  /** Envia fragmentos y no termina nunca (para el tiempo maximo). */
  | { kind: "hang"; before?: string[] }
  /** El stream se corta sin `done` y SIN guardar. */
  | { kind: "cut"; before?: string[] }
  /** El servidor guarda el intercambio pero la respuesta se pierde (stream cortado sin `done`). */
  | { kind: "saved_but_lost"; chunks: string[] };

interface ServerMessage {
  id: number;
  sender: "KOMI_AI" | "USER";
  content: string;
  turn_number: number;
  created_at: string;
}

interface ServerChat {
  chat_id: string;
  session_id: string;
  turn_count: number;
  is_closed: boolean;
  key_takeaway: string | null;
  messages: ServerMessage[];
  pending: boolean;
}

export interface FakeCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
  signal: AbortSignal | null;
}

const OPENING = "Hola, soy Komi. ¿Qué fue lo que más te llamó la atención de tu lectura de hoy?";

export function createFakeServer(options: { profileId?: string } = {}) {
  const chats = new Map<string, ServerChat>();
  const knownSessions = new Set<string>();
  const invalidSessions = new Set<string>();
  const script: Reply[] = [];
  const calls: FakeCall[] = [];
  const state = {
    /** /profile/sync/ responde 503 (para probar la sesion pendiente). */
    syncDown: false,
    /** /profile/sync/ falla como sin conexion (fetch rechaza). */
    syncOffline: false,
    /** /profile/sync/ rechaza todas las sesiones con este codigo (200 con `rejected`). */
    rejectSessionsWith: null as string | null,
    /** El stream de mensajes fue cancelado por el cliente. */
    cancelled: 0,
    nextId: 1,
  };
  let seq = 0;

  const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

  function serialize(chat: ServerChat) {
    return {
      chat_id: chat.chat_id,
      session_id: chat.session_id,
      turn_count: chat.turn_count,
      is_closed: chat.is_closed,
      key_takeaway: chat.key_takeaway,
      messages: chat.messages,
    };
  }

  function sse(event: string, data: unknown): string {
    return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  }

  function streamOf(
    parts: Array<string | Deferred>,
    onCancel: () => void,
    open: boolean,
    signal: AbortSignal | null,
    byteSplit?: number,
  ): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    let cancelled = false;
    return new ReadableStream<Uint8Array>({
      async start(controller) {
        // Como un fetch real: si se cancela la peticion, la lectura del cuerpo falla con AbortError.
        signal?.addEventListener(
          "abort",
          () => {
            cancelled = true;
            try {
              controller.error(new DOMException("Aborted", "AbortError"));
            } catch {
              // El flujo ya estaba cerrado.
            }
          },
          { once: true },
        );
        for (const part of parts) {
          if (cancelled) return;
          if (typeof part !== "string") {
            await part.promise;
            continue;
          }
          const bytes = encoder.encode(part);
          if (byteSplit) {
            for (let i = 0; i < bytes.length && !cancelled; i += byteSplit) {
              controller.enqueue(bytes.slice(i, i + byteSplit));
              await Promise.resolve();
            }
          } else {
            controller.enqueue(bytes);
          }
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        if (!open && !cancelled) controller.close();
      },
      cancel() {
        cancelled = true;
        onCancel();
      },
    });
  }

  function sseResponse(stream: ReadableStream<Uint8Array>) {
    return new Response(stream, {
      status: 200,
      headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache" },
    });
  }

  function handleStart(body: { session_id?: string }) {
    const sessionId = String(body.session_id ?? "");
    if (!knownSessions.has(sessionId)) return json(404, { detail: "No encontrado." });
    if (invalidSessions.has(sessionId)) {
      return json(409, { detail: "La sesion no es valida.", code: "session_invalid" });
    }
    const existing = [...chats.values()].find((chat) => chat.session_id === sessionId);
    if (existing) return json(200, serialize(existing));
    seq += 1;
    const chat: ServerChat = {
      chat_id: `00000000-0000-4000-8000-${String(900 + seq).padStart(12, "0")}`,
      session_id: sessionId,
      turn_count: 1,
      is_closed: false,
      key_takeaway: null,
      messages: [
        { id: state.nextId++, sender: "KOMI_AI", content: OPENING, turn_number: 1, created_at: "2026-11-06T10:00:00Z" },
      ],
      pending: false,
    };
    chats.set(chat.chat_id, chat);
    return json(201, serialize(chat));
  }

  function save(chat: ServerChat, content: string, reply: string, seed: string | null) {
    chat.messages.push(
      { id: state.nextId++, sender: "USER", content, turn_number: chat.turn_count, created_at: "2026-11-06T10:01:00Z" },
      { id: state.nextId++, sender: "KOMI_AI", content: reply, turn_number: chat.turn_count + 1, created_at: "2026-11-06T10:01:05Z" },
    );
    chat.turn_count += 1;
    if (chat.turn_count >= 5) {
      chat.is_closed = true;
      chat.key_takeaway = seed;
    }
  }

  function handleMessage(chatId: string, body: { content?: unknown; turn?: unknown }, signal: AbortSignal | null) {
    const chat = chats.get(chatId);
    if (!chat) return json(404, { detail: "No encontrado." });
    const content = typeof body.content === "string" ? body.content.trim() : "";
    if (content === "" || [...content].length > 2000) return json(400, { content: ["Contenido invalido."] });
    if (chat.is_closed || chat.turn_count >= 5) return json(409, { detail: "Charla cerrada.", code: "chat_closed" });
    if (body.turn !== undefined && body.turn !== chat.turn_count) {
      return json(409, { detail: "Turno desfasado.", code: "turn_mismatch" });
    }
    if (chat.pending) return json(409, { detail: "Respuesta en curso.", code: "reply_in_progress" });

    const reply = script.shift();
    if (!reply) return json(500, { detail: "Sin respuesta programada." });
    if (reply.kind === "network") throw new TypeError("Failed to fetch");
    if (reply.kind === "http") {
      return json(reply.status, { detail: "Error.", ...(reply.code ? { code: reply.code } : {}) }, reply.headers);
    }

    const cancel = () => {
      state.cancelled += 1;
      chat.pending = false;
    };
    const closeLock = () => {
      chat.pending = false;
    };
    chat.pending = true;
    if (signal) {
      signal.addEventListener("abort", cancel, { once: true });
    }

    if (reply.kind === "sse_error") {
      const parts = [
        ...(reply.before ?? []).map((text) => sse("chunk", { text })),
        sse("error", { code: reply.code, retry_after: reply.retry_after ?? null }),
      ];
      closeLock();
      return sseResponse(streamOf(parts, cancel, false, signal));
    }
    if (reply.kind === "hang") {
      return sseResponse(streamOf((reply.before ?? []).map((text) => sse("chunk", { text })), cancel, true, signal));
    }
    if (reply.kind === "cut") {
      closeLock();
      return sseResponse(streamOf((reply.before ?? []).map((text) => sse("chunk", { text })), cancel, false, signal));
    }
    if (reply.kind === "saved_but_lost") {
      save(chat, content, reply.chunks.join(""), null);
      closeLock();
      return sseResponse(streamOf(reply.chunks.map((text) => sse("chunk", { text })), cancel, false, signal));
    }

    const text = reply.chunks.join("");
    const parts: Array<string | Deferred> = [];
    reply.chunks.forEach((chunk, index) => {
      parts.push(sse("chunk", { text: chunk }));
      if (index === 0 && reply.hold) parts.push(reply.hold);
    });
    // El guardado atomico ocurre al terminar el stream, no antes.
    const finalPart = () => {
      save(chat, content, text, reply.seed ?? null);
      closeLock();
      return sse("done", {
        turn: chat.turn_count,
        is_closed: chat.is_closed,
        key_takeaway: chat.key_takeaway,
        content: text,
      });
    };
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let cancelled = false;
        signal?.addEventListener(
          "abort",
          () => {
            cancelled = true;
            try {
              controller.error(new DOMException("Aborted", "AbortError"));
            } catch {
              // El flujo ya estaba cerrado.
            }
          },
          { once: true },
        );
        for (const part of parts) {
          if (cancelled) return;
          if (typeof part !== "string") {
            await part.promise;
            continue;
          }
          const bytes = encoder.encode(part);
          if (reply.byteSplit) {
            for (let i = 0; i < bytes.length; i += reply.byteSplit) {
              controller.enqueue(bytes.slice(i, i + reply.byteSplit));
              await Promise.resolve();
            }
          } else {
            controller.enqueue(bytes);
          }
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        if (cancelled) return;
        controller.enqueue(encoder.encode(finalPart()));
        controller.close();
      },
      cancel,
    });
    return sseResponse(stream);
  }

  function handleSync(body: { books?: Array<{ id: string }>; sessions?: Array<{ id: string }> }) {
    if (state.syncOffline) throw new TypeError("Failed to fetch");
    if (state.syncDown) return json(503, { detail: "No disponible." });
    const rejecting = state.rejectSessionsWith;
    const sessions = body.sessions ?? [];
    if (rejecting === null) for (const session of sessions) knownSessions.add(session.id);
    return json(200, {
      books: { accepted: (body.books ?? []).map((book) => ({ id: book.id, result: "created" })), rejected: [] },
      sessions: {
        accepted: rejecting === null ? sessions.map((session) => ({ id: session.id, result: "created" })) : [],
        rejected:
          rejecting === null
            ? []
            : sessions.map((session, index) => ({ index, id: session.id, code: rejecting, detail: "x" })),
      },
      server_books: [],
      streak: { current: 1, longest: 1, last_valid_session_date: null },
    });
  }

  const fetchFn = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    const rawHeaders = (init?.headers ?? {}) as Record<string, string>;
    const body: unknown = init?.body ? JSON.parse(String(init.body)) : undefined;
    const signal = (init?.signal as AbortSignal | undefined) ?? null;
    calls.push({ url, method: init?.method ?? "GET", headers: rawHeaders, body, signal });
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (options.profileId && rawHeaders["X-Profile-Id"] !== options.profileId) {
      return json(401, { detail: "Perfil no valido." });
    }
    if (url.endsWith("/profile/sync/")) return handleSync(body as never);
    if (url.endsWith("/companion/start/")) return handleStart(body as never);
    const message = /\/companion\/([^/]+)\/message\/$/.exec(url);
    if (message) return handleMessage(decodeURIComponent(message[1] as string), body as never, signal);
    return json(404, { detail: "No encontrado." });
  });

  return {
    fetchFn,
    calls,
    state,
    chats,
    /** La sesion ya esta en el servidor (la sincronizacion la acepto). */
    knowSession(id: string) {
      knownSessions.add(id);
    },
    invalidateSession(id: string) {
      invalidSessions.add(id);
    },
    /** Programa la siguiente respuesta de /message/. */
    reply(...replies: Reply[]) {
      script.push(...replies);
    },
    pendingReplies: () => script.length,
    messageCalls: () => calls.filter((call) => /\/message\/$/.test(call.url)),
    startCalls: () => calls.filter((call) => call.url.endsWith("/companion/start/")),
    syncCalls: () => calls.filter((call) => call.url.endsWith("/profile/sync/")),
    /** Fuerza el estado de una charla (por ejemplo, ya cerrada). */
    chatOf: (sessionId: string) => [...chats.values()].find((chat) => chat.session_id === sessionId),
    lock(sessionId: string) {
      const chat = [...chats.values()].find((item) => item.session_id === sessionId);
      if (chat) chat.pending = true;
    },
    unlock(sessionId: string) {
      const chat = [...chats.values()].find((item) => item.session_id === sessionId);
      if (chat) chat.pending = false;
    },
  };
}

export type FakeServer = ReturnType<typeof createFakeServer>;
