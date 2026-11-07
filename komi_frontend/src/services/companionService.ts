// Servicio de la charla con Komi (CU-05). Reglas que el cliente aplica por su cuenta:
//   - el chat solo abre si ESTA sesion ya esta aceptada por el servidor (`sessionGate`, que hace flush);
//   - `start/` es idempotente: retoma la charla de la sesion con sus mensajes;
//   - 404: se sube lo pendiente (flush) y se reintenta una vez antes de rendirse;
//   - `turn_mismatch` y `chat_closed`: se resincroniza con `start/` (el servidor manda);
//   - antes de cada envio se espera a que el servidor este despierto (plan gratuito que duerme);
//   - `reply_in_progress`: se espera y se reintenta una vez;
//   - tras cada respuesta, `turn_count`, `is_closed` y la semilla se guardan en `reflections`
//     (los mensajes viven solo en memoria y se recuperan con `start/`).
// El limite de 5 turnos y el de 2000 caracteres los hace cumplir el servidor; aqui se anticipan
// para no gastar una peticion. Nunca se escribe el texto del lector en consola.

import {
  CompanionError,
  MAX_MESSAGE_CHARS,
  countChars,
  type CompanionChat,
  type CompanionClient,
  type CompanionDone,
  type CompanionFailureKind,
  type CompanionMessage,
} from "../data/network/companionClient";
import type { LocalReflectionRepository } from "../data/local_db/localReflectionRepository";
import type { SessionGate } from "../data/network/syncService";

/** Pausa antes de reintentar un `reply_in_progress`. */
export const REPLY_IN_PROGRESS_WAIT_MS = 2_500;
/** Turnos de Komi del Ciclo Zen (el lector responde en los turnos 1 a 4). */
export const MAX_TURNS = 5;

export interface CompanionTarget {
  sessionId: string;
  bookId: string;
}

export type OpenResult =
  | { kind: "ready"; chat: CompanionChat }
  /** Sin conexion con el servidor (reintentable). */
  | { kind: "offline" }
  /** No se pudo sincronizar la sesion ahora (reintentable). */
  | { kind: "unsynced" }
  /** El servidor invalida la sesion (permanente: sin reintento). */
  | { kind: "rejected" }
  | { kind: "failed"; failure: CompanionFailureKind };

export type SendResult =
  | { kind: "done"; chat: CompanionChat; reply: string }
  /** El servidor tenia otro estado: se recargo la charla. `delivered` = el mensaje ya estaba guardado. */
  | { kind: "resynced"; chat: CompanionChat; delivered: boolean }
  | { kind: "failed"; failure: CompanionFailureKind; retryAfterSec: number | null };

export interface CompanionServiceDeps {
  client: Pick<CompanionClient, "start" | "send">;
  sync: { sessionGate(sessionId: string): Promise<SessionGate>; flush(): Promise<unknown> };
  /**
   * Despertar del servidor (arranque en frio del plan gratuito): antes de la puerta y de cada envio
   * se espera a que responda, hasta unos 90 s. Si no responde, sigue el flujo normal y su propio
   * error lo dira.
   */
  wake?: { ensureAwake(maxMs?: number): Promise<boolean> };
  reflections: Pick<LocalReflectionRepository, "upsert">;
  /** Pausa cancelable; en pruebas se reemplaza. */
  wait?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

function defaultWait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
  });
}

export function createCompanionService(deps: CompanionServiceDeps) {
  const { client, sync, reflections, wake } = deps;
  const wait = deps.wait ?? defaultWait;

  async function remember(target: CompanionTarget, chat: CompanionChat): Promise<void> {
    try {
      await reflections.upsert({
        chat_id: chat.chat_id,
        session_id: target.sessionId,
        book_id: target.bookId,
        turn_count: chat.turn_count,
        is_closed: chat.is_closed,
        key_takeaway: chat.key_takeaway,
      });
    } catch {
      // La charla ya vive en el servidor: si Dexie falla, la semilla se recupera con `start/`.
    }
  }

  function failureKind(error: unknown): CompanionError {
    return error instanceof CompanionError ? error : new CompanionError("unavailable");
  }

  /** Estado de la sesion ante el servidor; un fallo inesperado cuenta como "no se pudo sincronizar". */
  async function checkGate(sessionId: string): Promise<SessionGate> {
    try {
      // Un servidor dormido tarda en responder: sin esta espera el flush agotaria sus 10 s y la
      // puerta diria "sin conexion". Nunca lanza; si no despierta, sigue el flujo normal.
      await wake?.ensureAwake().catch(() => false);
      return await sync.sessionGate(sessionId);
    } catch {
      return { state: "unsynced" };
    }
  }

  /** Abre o retoma la charla de la sesion. */
  async function open(target: CompanionTarget): Promise<OpenResult> {
    const gate = await checkGate(target.sessionId);
    if (gate.state !== "ready") return { kind: gate.state === "rejected" ? "rejected" : gate.state };

    let attempt = 0;
    for (;;) {
      try {
        const chat = await client.start(target.sessionId);
        await remember(target, chat);
        return { kind: "ready", chat };
      } catch (error) {
        const failure = failureKind(error);
        if (failure.kind === "offline") return { kind: "offline" };
        if (failure.kind === "not_found" && attempt === 0) {
          // La sesion pudo quedar a medio subir: se intenta subir otra vez antes de rendirse.
          attempt += 1;
          try {
            await sync.flush();
          } catch {
            // Sin red o con error: el reintento de abajo lo dira.
          }
          continue;
        }
        return { kind: "failed", failure: failure.kind };
      }
    }
  }

  /** Recarga la charla con `start/` (el servidor es la fuente de verdad). */
  async function resync(target: CompanionTarget): Promise<CompanionChat> {
    const chat = await client.start(target.sessionId);
    await remember(target, chat);
    return chat;
  }

  /**
   * Envia el mensaje del lector. `chat.turn_count` es el turno de Komi al que responde. Si falla,
   * no cambia nada: el llamador conserva el texto y puede reenviar el mismo turno.
   */
  async function send(
    target: CompanionTarget,
    chat: CompanionChat,
    text: string,
    options: { signal?: AbortSignal; onChunk: (chunk: string) => void },
  ): Promise<SendResult> {
    const content = text.trim();
    if (content === "" || countChars(content) > MAX_MESSAGE_CHARS) {
      return { kind: "failed", failure: "validation", retryAfterSec: null };
    }
    if (chat.is_closed || chat.turn_count >= MAX_TURNS) {
      return { kind: "resynced", chat, delivered: false };
    }

    // "Despierto" caduca a los 10 min: tras una pausa larga el servidor pudo dormirse y el envio
    // se quedaria esperando o fallaria. Con el estado vigente esto responde de inmediato. Nunca
    // lanza; si no despierta, el envio sigue y su propio error lo dira.
    await wake?.ensureAwake().catch(() => false);
    if (options.signal?.aborted) return { kind: "failed", failure: "aborted", retryAfterSec: null };

    const turn = chat.turn_count;
    let waited = false;
    for (;;) {
      try {
        const done: CompanionDone = await client.send({
          chatId: chat.chat_id,
          content,
          turn,
          ...(options.signal ? { signal: options.signal } : {}),
          onChunk: options.onChunk,
        });
        const messages: CompanionMessage[] = [
          ...chat.messages,
          { sender: "USER", content, turn_number: turn },
          { sender: "KOMI_AI", content: done.content, turn_number: done.turn },
        ];
        const next: CompanionChat = {
          ...chat,
          turn_count: done.turn,
          is_closed: done.is_closed,
          key_takeaway: done.key_takeaway,
          messages,
        };
        await remember(target, next);
        return { kind: "done", chat: next, reply: done.content };
      } catch (error) {
        const failure = failureKind(error);
        if (failure.kind === "reply_in_progress" && !waited) {
          waited = true;
          await wait(REPLY_IN_PROGRESS_WAIT_MS, options.signal);
          if (options.signal?.aborted) return { kind: "failed", failure: "aborted", retryAfterSec: null };
          continue;
        }
        if (failure.kind === "turn_mismatch" || failure.kind === "chat_closed") {
          try {
            const fresh = await resync(target);
            // Entregado solo si el servidor ya tiene ESE mensaje en ESE turno (respuesta perdida);
            // si otro dispositivo avanzo la charla, el texto del lector se conserva.
            const delivered = fresh.messages.some(
              (message) =>
                message.sender === "USER" && message.turn_number === turn && message.content.trim() === content,
            );
            return { kind: "resynced", chat: fresh, delivered };
          } catch (resyncError) {
            const again = failureKind(resyncError);
            return { kind: "failed", failure: again.kind, retryAfterSec: null };
          }
        }
        return { kind: "failed", failure: failure.kind, retryAfterSec: failure.retryAfterSec };
      }
    }
  }

  return { open, send, gate: checkGate };
}

export type CompanionService = ReturnType<typeof createCompanionService>;
