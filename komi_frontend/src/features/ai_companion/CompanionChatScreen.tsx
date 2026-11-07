// Charla con Komi (CU-05): pantalla completa, sin navegacion inferior. Tres bloques funcionales:
// contexto (libro y "Ciclo Zen: Turno X de 5"), conversacion y cierre/redaccion. La charla tiene
// 5 turnos de Komi; el lector responde en 4. Salir antes del quinto turno pide confirmacion porque
// v1.0 no tiene cierre anticipado (limitacion conocida, SRS 19.18).

import { useEffect, useId, useRef, useState } from "react";
import { ZenPrimaryButton } from "../../core/components/ZenPrimaryButton";
import { ZenSheet } from "../../core/components/ZenSheet";
import { MAX_MESSAGE_CHARS } from "../../data/network/companionClient";
import type { LocalBook } from "../../data/local_db/types";
import type { ReloadGate } from "../../pwa/reloadGate";
import { MAX_TURNS, type CompanionService } from "../../services/companionService";
import { GATE_MESSAGES } from "./chatGateMessages";
import { useCompanionChat } from "./useCompanionChat";
import "./CompanionChatScreen.css";

export interface CompanionChatScreenProps {
  service: CompanionService;
  gate: ReloadGate;
  /** El servidor esta arrancando (plan gratuito): se avisa en lugar de "Conectando con Komi". */
  waking?: boolean;
  sessionId: string;
  book: LocalBook;
  /** Volver al jardin: la charla termino, se abandonó o no se pudo abrir. */
  onLeave: () => void;
}

/** Desde cuantos caracteres se muestra el contador. */
const COUNTER_FROM = 1800;

function openFailureText(kind: string | null): string {
  if (kind === "session_invalid") return "Esta sesión no cuenta para la charla con Komi. Tu lectura sigue guardada.";
  if (kind === "not_found") {
    return "Esta lectura todavía no llegó al servidor, así que no podemos abrir la charla. Tu avance está a salvo.";
  }
  return "No pudimos abrir la charla con Komi. Tu lectura sigue guardada; inténtalo de nuevo.";
}

function cooldownText(seconds: number): string {
  return seconds >= 100 ? `Podrás reintentar en ${Math.ceil(seconds / 60)} min` : `Podrás reintentar en ${seconds} s`;
}

export function CompanionChatScreen({
  service,
  gate,
  waking = false,
  sessionId,
  book,
  onLeave,
}: CompanionChatScreenProps) {
  const chat = useCompanionChat(service, { sessionId, bookId: book.id }, gate);
  const [confirming, setConfirming] = useState(false);
  const fieldId = useId();
  const counterId = useId();
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "end" });
  }, [chat.chat?.messages.length, chat.streamed, chat.pending, chat.typing]);

  const closed = chat.chat?.is_closed === true;
  const turn = chat.chat?.turn_count ?? 1;

  const requestLeave = () => {
    // Sin charla abierta, o ya cerrada, no hay nada que perder.
    if (chat.phase === "ready" && !closed) setConfirming(true);
    else onLeave();
  };

  return (
    <div className="companion" data-testid="companion-chat">
      <header className="companion__context" data-block="context">
        <p className="companion__book">
          <span className="companion__book-title">{book.title}</span>
          <span className="companion__book-author">{book.author}</span>
        </p>
        {chat.phase === "ready" && (
          <p className="companion__turns tabular" data-testid="zen-cycle">
            Ciclo Zen: Turno {turn} de {MAX_TURNS}
          </p>
        )}
      </header>

      <section className="companion__conversation" data-block="conversation" aria-label="Conversación con Komi">
        {chat.phase === "opening" && (
          <p className="companion__status" role="status">
            {waking ? "Despertando a Komi" : "Conectando con Komi"}
          </p>
        )}

        {(chat.phase === "offline" || chat.phase === "unsynced" || chat.phase === "rejected") && (
          <div className="companion__status-block">
            <p className="companion__status" role="status">
              {GATE_MESSAGES[chat.phase]}
            </p>
          </div>
        )}

        {chat.phase === "failed" && (
          <p className="companion__status" role="alert">
            {openFailureText(chat.openFailure)}
          </p>
        )}

        {chat.phase === "ready" && chat.chat && (
          <>
            <ol className="companion__messages" role="log" aria-live="polite" aria-relevant="additions">
              {chat.chat.messages.map((message) => (
                <li
                  key={`${message.sender}-${message.turn_number}`}
                  className="companion__message"
                  data-sender={message.sender}
                >
                  <span className="companion__who">{message.sender === "KOMI_AI" ? "Komi" : "Tú"}</span>
                  <p className="companion__bubble">{message.content}</p>
                </li>
              ))}
              {chat.pending !== null && (
                <li className="companion__message" data-sender="USER">
                  <span className="companion__who">Tú</span>
                  <p className="companion__bubble">{chat.pending}</p>
                </li>
              )}
            </ol>
            {chat.streamed !== "" && (
              <div className="companion__message" data-sender="KOMI_AI" aria-live="off" aria-busy="true">
                <span className="companion__who">Komi</span>
                <p className="companion__bubble" data-testid="streaming-bubble">
                  {chat.streamed}
                </p>
              </div>
            )}
            {chat.typing && (
              <p className="companion__typing" role="status" data-testid="typing">
                {waking ? "Despertando a Komi" : "Komi está escribiendo"}
                <span className="companion__dots" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
              </p>
            )}
          </>
        )}
        <div ref={end} />
      </section>

      <footer className="companion__composer" data-block="composer">
        {chat.phase === "ready" && !closed && (
          <>
            <label className="companion__label" htmlFor={fieldId}>
              Tu respuesta
            </label>
            <textarea
              id={fieldId}
              className="companion__field"
              rows={3}
              value={chat.draft}
              disabled={chat.sending}
              aria-describedby={chat.charCount >= COUNTER_FROM ? counterId : undefined}
              onChange={(event) => chat.setDraft(event.target.value)}
            />
            {chat.charCount >= COUNTER_FROM && (
              <p
                className={chat.tooLong ? "companion__counter companion__counter--over tabular" : "companion__counter tabular"}
                id={counterId}
                role={chat.tooLong ? "alert" : undefined}
              >
                {chat.charCount} de {MAX_MESSAGE_CHARS} caracteres
                {chat.tooLong ? ". Acorta tu mensaje para enviarlo." : ""}
              </p>
            )}
            {chat.notice && (
              <p className="companion__notice" role="alert">
                {chat.notice.message}
              </p>
            )}
            {chat.cooldownSec !== null && (
              <p className="companion__notice tabular" role="status">
                {cooldownText(chat.cooldownSec)}
              </p>
            )}
            <ZenPrimaryButton disabled={!chat.canSend} onClick={chat.send}>
              {chat.notice?.retry ? "Reintentar" : "Enviar"}
            </ZenPrimaryButton>
            <ZenPrimaryButton variant="secondary" onClick={requestLeave}>
              Volver al jardín
            </ZenPrimaryButton>
          </>
        )}

        {chat.phase === "ready" && closed && (
          <>
            <p className="companion__seed" data-testid="seed">
              <span className="companion__label">Semilla del día</span>
              {chat.chat?.key_takeaway ?? "Tu charla con Komi terminó. Gracias por leer hoy."}
            </p>
            <ZenPrimaryButton onClick={onLeave}>Guardar reflexión y volver al jardín</ZenPrimaryButton>
          </>
        )}

        {(chat.phase === "offline" ||
          chat.phase === "unsynced" ||
          chat.phase === "rejected" ||
          chat.phase === "failed") && (
          <>
            {chat.phase === "offline" ||
            chat.phase === "unsynced" ||
            (chat.phase === "failed" && chat.openFailure !== "session_invalid" && chat.openFailure !== "not_found") ? (
              <ZenPrimaryButton onClick={chat.reopen}>Reintentar</ZenPrimaryButton>
            ) : null}
            <ZenPrimaryButton variant="secondary" onClick={onLeave}>
              Volver al jardín
            </ZenPrimaryButton>
          </>
        )}

        {chat.phase === "opening" && (
          <ZenPrimaryButton variant="secondary" onClick={onLeave}>
            Volver al jardín
          </ZenPrimaryButton>
        )}
      </footer>

      {confirming && (
        <ZenSheet title="¿Salir de la charla?" onClose={() => setConfirming(false)}>
          <div className="companion__confirm">
            <p className="companion__status">
              Si sales ahora, no podrás retomar esta charla.
            </p>
            <ZenPrimaryButton onClick={() => setConfirming(false)}>Seguir charlando</ZenPrimaryButton>
            <ZenPrimaryButton variant="secondary" onClick={onLeave}>
              Salir de todos modos
            </ZenPrimaryButton>
          </div>
        </ZenSheet>
      )}
    </div>
  );
}
