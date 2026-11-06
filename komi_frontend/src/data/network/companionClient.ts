// Cliente de la charla con Komi (CU-05, SRS 17.20). `start/` es JSON e idempotente; el mensaje
// responde por SSE y se lee con fetch + ReadableStream (EventSource no admite POST ni cabeceras).
//
// Eventos: `chunk {text}`, `done {turn, is_closed, key_takeaway, content}` y `error {code,
// retry_after}`. Ante un `error` el texto parcial NO se entrega: el servidor no guardo nada y el
// lector puede reenviar el mismo mensaje con el mismo turno. No se registra texto del lector.

import { ApiError, type ApiClient } from "./apiClient";

/** Tiempo maximo de una respuesta (el servidor tambien corta a los 60 s). */
export const STREAM_TIMEOUT_MS = 60_000;
/** Tope del mensaje del lector, en caracteres (SRS 17, punto 12). */
export const MAX_MESSAGE_CHARS = 2000;

export type CompanionSender = "KOMI_AI" | "USER";

export interface CompanionMessage {
  sender: CompanionSender;
  content: string;
  turn_number: number;
}

export interface CompanionChat {
  chat_id: string;
  session_id: string;
  turn_count: number;
  is_closed: boolean;
  key_takeaway: string | null;
  messages: CompanionMessage[];
}

export interface CompanionDone {
  turn: number;
  is_closed: boolean;
  key_takeaway: string | null;
  content: string;
}

export type CompanionFailureKind =
  | "offline" // sin red o sin servidor configurado
  | "not_found" // 404: la charla o la sesion no estan en el servidor
  | "session_invalid" // 409: la sesion fue invalidada
  | "chat_closed" // 409
  | "reply_in_progress" // 409
  | "turn_mismatch" // 409
  | "quota" // 429 o quota_exceeded
  | "unavailable" // 503, 5xx, unavailable, internal, conflict
  | "truncated" // respuesta cortada por MAX_TOKENS
  | "timeout" // 60 s sin terminar
  | "interrupted" // el stream se cerro sin `done`
  | "invalid_response" // contrato roto
  | "validation" // 400
  | "aborted"; // el lector salio (desmontaje)

export class CompanionError extends Error {
  readonly kind: CompanionFailureKind;
  /** Segundos que informa el servidor (solo `quota`). */
  readonly retryAfterSec: number | null;

  constructor(kind: CompanionFailureKind, retryAfterSec: number | null = null) {
    super(`Charla con Komi: ${kind}`);
    this.name = "CompanionError";
    this.kind = kind;
    this.retryAfterSec = retryAfterSec;
  }
}

/** Cuenta caracteres como el servidor (puntos de codigo, no unidades UTF-16). */
export function countChars(text: string): number {
  return [...text].length;
}

function failureFromHttp(error: ApiError): CompanionError {
  const status = error.status;
  if (status === 404) return new CompanionError("not_found");
  if (status === 400) return new CompanionError("validation");
  if (status === 409) {
    if (error.code === "chat_closed") return new CompanionError("chat_closed");
    if (error.code === "reply_in_progress") return new CompanionError("reply_in_progress");
    if (error.code === "turn_mismatch") return new CompanionError("turn_mismatch");
    if (error.code === "session_invalid") return new CompanionError("session_invalid");
    return new CompanionError("unavailable");
  }
  if (status === 429) return new CompanionError("quota", error.retryAfterSec);
  return new CompanionError("unavailable");
}

function toCompanionError(error: unknown): CompanionError {
  if (error instanceof CompanionError) return error;
  if (error instanceof ApiError) {
    if (error.kind === "network" || error.kind === "not_configured") return new CompanionError("offline");
    if (error.kind === "timeout") return new CompanionError("timeout");
    if (error.kind === "invalid_response") return new CompanionError("invalid_response");
    return failureFromHttp(error);
  }
  return new CompanionError("unavailable");
}

function failureFromEvent(data: unknown): CompanionError {
  const record = (data ?? {}) as { code?: unknown; retry_after?: unknown };
  const retry =
    typeof record.retry_after === "number" && Number.isFinite(record.retry_after) && record.retry_after >= 0
      ? Math.ceil(record.retry_after)
      : null;
  switch (record.code) {
    case "quota_exceeded":
      return new CompanionError("quota", retry);
    case "truncated":
      return new CompanionError("truncated");
    case "timeout":
      return new CompanionError("timeout");
    default:
      // unavailable, internal, conflict o un codigo nuevo: se puede reintentar tal cual.
      return new CompanionError("unavailable");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseChat(data: unknown): CompanionChat {
  if (!isRecord(data)) throw new CompanionError("invalid_response");
  const { chat_id, session_id, turn_count, is_closed, key_takeaway, messages } = data;
  if (
    typeof chat_id !== "string" ||
    typeof session_id !== "string" ||
    typeof turn_count !== "number" ||
    !Number.isInteger(turn_count) ||
    typeof is_closed !== "boolean" ||
    !Array.isArray(messages)
  ) {
    throw new CompanionError("invalid_response");
  }
  const parsed: CompanionMessage[] = [];
  for (const item of messages) {
    if (
      !isRecord(item) ||
      (item.sender !== "KOMI_AI" && item.sender !== "USER") ||
      typeof item.content !== "string" ||
      typeof item.turn_number !== "number"
    ) {
      throw new CompanionError("invalid_response");
    }
    parsed.push({ sender: item.sender, content: item.content, turn_number: item.turn_number });
  }
  return {
    chat_id,
    session_id,
    turn_count,
    is_closed,
    key_takeaway: typeof key_takeaway === "string" && key_takeaway.trim() !== "" ? key_takeaway : null,
    messages: parsed,
  };
}

function parseDone(data: unknown): CompanionDone {
  if (
    !isRecord(data) ||
    typeof data.turn !== "number" ||
    typeof data.is_closed !== "boolean" ||
    typeof data.content !== "string"
  ) {
    throw new CompanionError("invalid_response");
  }
  const seed = data.key_takeaway;
  return {
    turn: data.turn,
    is_closed: data.is_closed,
    key_takeaway: typeof seed === "string" && seed.trim() !== "" ? seed : null,
    content: data.content,
  };
}

interface SseBlock {
  event: string;
  data: string;
}

/** Acumula texto y entrega bloques SSE completos (separados por una linea en blanco). */
export function createSseParser() {
  let buffer = "";
  return {
    push(text: string): SseBlock[] {
      buffer += text.replace(/\r\n?/g, "\n");
      const blocks: SseBlock[] = [];
      let cut = buffer.indexOf("\n\n");
      while (cut !== -1) {
        const raw = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);
        let event = "message";
        const data: string[] = [];
        for (const line of raw.split("\n")) {
          if (line === "" || line.startsWith(":")) continue;
          const colon = line.indexOf(":");
          const field = colon === -1 ? line : line.slice(0, colon);
          let value = colon === -1 ? "" : line.slice(colon + 1);
          if (value.startsWith(" ")) value = value.slice(1);
          if (field === "event") event = value;
          else if (field === "data") data.push(value);
        }
        if (data.length > 0 || event !== "message") blocks.push({ event, data: data.join("\n") });
        cut = buffer.indexOf("\n\n");
      }
      return blocks;
    },
  };
}

export interface SendRequest {
  chatId: string;
  content: string;
  /** Turno de Komi al que responde el lector (1 a 4). */
  turn: number;
  /** El lector salio: cancela la peticion y suelta la lectura del stream. */
  signal?: AbortSignal;
  onChunk: (text: string) => void;
}

export function createCompanionClient(api: ApiClient) {
  async function start(sessionId: string): Promise<CompanionChat> {
    try {
      const response = await api.post<unknown>("/companion/start/", { body: { session_id: sessionId } });
      return parseChat(response.data);
    } catch (error) {
      throw toCompanionError(error);
    }
  }

  async function send(request: SendRequest): Promise<CompanionDone> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, STREAM_TIMEOUT_MS);
    const external = request.signal;
    const onExternalAbort = () => controller.abort();
    if (external?.aborted) controller.abort();
    else external?.addEventListener("abort", onExternalAbort, { once: true });

    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    try {
      const response = await api.openStream(`/companion/${encodeURIComponent(request.chatId)}/message/`, {
        body: { content: request.content, turn: request.turn },
        signal: controller.signal,
      });
      if (!response.body) throw new CompanionError("invalid_response");
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      const parser = createSseParser();
      for (;;) {
        const { done, value } = await reader.read();
        const blocks = parser.push(done ? decoder.decode() : decoder.decode(value, { stream: true }));
        for (const block of blocks) {
          let payload: unknown;
          try {
            payload = block.data === "" ? {} : JSON.parse(block.data);
          } catch {
            throw new CompanionError("invalid_response");
          }
          if (block.event === "chunk") {
            const text = isRecord(payload) ? payload.text : undefined;
            if (typeof text !== "string") throw new CompanionError("invalid_response");
            request.onChunk(text);
          } else if (block.event === "error") {
            throw failureFromEvent(payload);
          } else if (block.event === "done") {
            return parseDone(payload);
          }
        }
        if (done) throw new CompanionError("interrupted");
      }
    } catch (error) {
      if (timedOut) throw new CompanionError("timeout");
      if (external?.aborted) throw new CompanionError("aborted");
      throw toCompanionError(error);
    } finally {
      clearTimeout(timer);
      external?.removeEventListener("abort", onExternalAbort);
      // Suelta la conexion si salimos antes del final (error, timeout o cancelacion).
      reader?.cancel().catch(() => {});
    }
  }

  return { start, send };
}

export type CompanionClient = ReturnType<typeof createCompanionClient>;
