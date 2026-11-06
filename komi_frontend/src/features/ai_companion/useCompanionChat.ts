// Estado de la charla con Komi para la pantalla. Reglas que vive aqui (y no en el JSX):
//   - un solo envio a la vez (candado sincrono: dos toques seguidos no duplican la peticion);
//   - la puerta de recarga del Service Worker se bloquea SOLO mientras hay streaming;
//   - si el lector sale (desmontaje) se cancela el stream;
//   - tras un error se descarta el texto parcial de Komi y se conserva lo que escribio el lector,
//     para reenviar el mismo turno;
//   - con `quota_exceeded` y `retry_after` el reintento espera una cuenta atras (por marcas de
//     tiempo, no por ticks).

import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_MESSAGE_CHARS, countChars, type CompanionChat, type CompanionFailureKind } from "../../data/network/companionClient";
import type { ReloadGate } from "../../pwa/reloadGate";
import type { CompanionService, CompanionTarget } from "../../services/companionService";

export type ChatPhase = "opening" | "ready" | "offline" | "failed";

export interface ChatNotice {
  message: string;
  /** El lector puede reenviar el mismo turno. */
  retry: boolean;
}

export interface UseCompanionChat {
  phase: ChatPhase;
  /** Motivo cuando `phase` es "failed" (no se pudo abrir la charla). */
  openFailure: CompanionFailureKind | null;
  chat: CompanionChat | null;
  draft: string;
  setDraft: (text: string) => void;
  /** Mensaje del lector enviado que aun espera respuesta. */
  pending: string | null;
  /** Texto parcial de Komi que va llegando. */
  streamed: string;
  /** "Komi esta escribiendo": desde el envio hasta el primer fragmento. */
  typing: boolean;
  sending: boolean;
  notice: ChatNotice | null;
  /** Segundos que faltan para poder reintentar (cuota agotada); null si no hay espera. */
  cooldownSec: number | null;
  charCount: number;
  tooLong: boolean;
  canSend: boolean;
  send: () => void;
  reopen: () => void;
}

const COOLDOWN_REPAINT_MS = 250;

export function noticeFor(failure: CompanionFailureKind): ChatNotice {
  switch (failure) {
    case "offline":
      return {
        message: "No hay conexión en este momento. Tu mensaje sigue aquí; inténtalo de nuevo cuando vuelva.",
        retry: true,
      };
    case "quota":
      return { message: "Komi necesita descansar un momento. Tu mensaje sigue aquí.", retry: true };
    case "timeout":
      return { message: "Komi tardó demasiado en responder. Tu mensaje sigue aquí; inténtalo de nuevo.", retry: true };
    case "truncated":
      return { message: "La respuesta de Komi se cortó. Tu mensaje sigue aquí; inténtalo de nuevo.", retry: true };
    case "reply_in_progress":
      return {
        message: "Komi sigue respondiendo a tu mensaje anterior. Dale un momento y vuelve a intentarlo.",
        retry: true,
      };
    case "validation":
      return { message: `Tu mensaje debe tener entre 1 y ${MAX_MESSAGE_CHARS} caracteres.`, retry: false };
    case "not_found":
      return {
        message: "Esta charla ya no está disponible en el servidor. Tu lectura sigue guardada.",
        retry: false,
      };
    case "session_invalid":
      return { message: "Esta sesión no cuenta para la charla con Komi.", retry: false };
    case "aborted":
      return { message: "", retry: false };
    default:
      return {
        message: "Komi no pudo responder ahora mismo. Tu mensaje sigue aquí; inténtalo de nuevo.",
        retry: true,
      };
  }
}

export function useCompanionChat(
  service: CompanionService,
  target: CompanionTarget,
  gate: ReloadGate,
): UseCompanionChat {
  const [phase, setPhase] = useState<ChatPhase>("opening");
  const [openFailure, setOpenFailure] = useState<CompanionFailureKind | null>(null);
  const [chat, setChat] = useState<CompanionChat | null>(null);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [streamed, setStreamed] = useState("");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<ChatNotice | null>(null);
  // Espera por cuota agotada: `until` es la hora de fin (marca de tiempo) y `left` lo que se muestra.
  const [cooldown, setCooldown] = useState<{ until: number; left: number } | null>(null);
  const [attempt, setAttempt] = useState(0);

  const mounted = useRef(true);
  const sendingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const releaseRef = useRef<(() => void) | null>(null);
  const { sessionId, bookId } = target;

  // Abre o retoma la charla. `alive` evita aplicar el resultado de una corrida anterior.
  useEffect(() => {
    let alive = true;
    void service.open({ sessionId, bookId }).then((result) => {
      if (!alive) return;
      if (result.kind === "ready") {
        setChat(result.chat);
        setPhase("ready");
      } else if (result.kind === "offline") {
        setPhase("offline");
      } else {
        setOpenFailure(result.failure);
        setPhase("failed");
      }
    });
    return () => {
      alive = false;
    };
  }, [service, sessionId, bookId, attempt]);

  // Salir de la pantalla cancela el stream y suelta la recarga.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      abortRef.current?.abort();
      releaseRef.current?.();
      releaseRef.current = null;
    };
  }, []);

  // Cuenta atras de la cuota: se recalcula con la hora, no se cuenta cada tick.
  const cooling = cooldown !== null;
  const until = cooldown?.until ?? 0;
  useEffect(() => {
    if (!cooling) return undefined;
    const id = window.setInterval(() => {
      const left = Math.ceil((until - Date.now()) / 1000);
      setCooldown(left <= 0 ? null : { until, left });
    }, COOLDOWN_REPAINT_MS);
    return () => window.clearInterval(id);
  }, [cooling, until]);

  const trimmed = draft.trim();
  const charCount = countChars(trimmed);
  const tooLong = charCount > MAX_MESSAGE_CHARS;
  const canSend =
    phase === "ready" &&
    chat !== null &&
    !chat.is_closed &&
    !sending &&
    !cooling &&
    trimmed !== "" &&
    !tooLong;

  const send = useCallback(() => {
    if (sendingRef.current || !chat || chat.is_closed) return;
    const text = draft.trim();
    if (text === "" || countChars(text) > MAX_MESSAGE_CHARS || cooldown !== null) return;

    sendingRef.current = true;
    setSending(true);
    setNotice(null);
    setPending(text);
    setStreamed("");
    setDraft("");
    const controller = new AbortController();
    abortRef.current = controller;
    releaseRef.current ??= gate.block();

    void service
      .send({ sessionId, bookId }, chat, text, {
        signal: controller.signal,
        onChunk: (chunk) => {
          if (mounted.current) setStreamed((current) => current + chunk);
        },
      })
      .then((result) => {
        if (!mounted.current) return;
        setPending(null);
        setStreamed("");
        if (result.kind === "done") {
          setChat(result.chat);
        } else if (result.kind === "resynced") {
          setChat(result.chat);
          if (!result.delivered && !result.chat.is_closed) {
            setDraft(text);
            setNotice({
              message: "Actualizamos la charla con lo que había en el servidor. Revisa tu mensaje y vuelve a enviarlo.",
              retry: true,
            });
          }
        } else {
          // Se descarta el texto parcial de Komi y se conserva lo del lector.
          setDraft(text);
          const next = noticeFor(result.failure);
          if (next.message !== "") setNotice(next);
          if (result.failure === "quota" && result.retryAfterSec !== null && result.retryAfterSec > 0) {
            setCooldown({ until: Date.now() + result.retryAfterSec * 1000, left: result.retryAfterSec });
          }
        }
      })
      .finally(() => {
        sendingRef.current = false;
        releaseRef.current?.();
        releaseRef.current = null;
        if (mounted.current) setSending(false);
      });
  }, [chat, draft, cooldown, gate, service, sessionId, bookId]);

  const reopen = useCallback(() => {
    setPhase("opening");
    setAttempt((value) => value + 1);
  }, []);

  return {
    phase,
    openFailure,
    chat,
    draft,
    setDraft,
    pending,
    streamed,
    typing: sending && streamed === "",
    sending,
    notice,
    cooldownSec: cooldown?.left ?? null,
    charCount,
    tooLong,
    canSend,
    send,
    reopen,
  };
}
