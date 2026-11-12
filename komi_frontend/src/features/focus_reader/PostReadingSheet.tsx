// Hoja post-lectura (CU-04 y CU-05). Paso 1: pagina alcanzada (solo libro fisico, validada contra
// `total_pages`). Guardar: sesion y avance en Dexie ANTES de invitar a la charla (CU-05, precondicion).
// Paso 2: invitacion opcional a conversar con Komi (`onChat` abre la charla, bloque 7).
//
// La sesion no se pierde: los registros `active_session` y `active_session_progress` y la puerta de
// recarga se sueltan (`onSaved`) solo cuando el guardado termino bien. Si se cierra la app en el
// Paso 1, la hoja reaparece al reabrir.

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { PreparationProgress } from "../../core/components/PreparationProgress";
import { ZenPrimaryButton } from "../../core/components/ZenPrimaryButton";
import { ZenSheet } from "../../core/components/ZenSheet";
import { KomiLocalError } from "../../data/local_db/errors";
import {
  InvalidPageError,
  type PostReadingService,
  type PreparedSession,
  type SaveResult,
} from "../../services/postReadingService";
import type { SessionGate } from "../../data/network/syncService";
import { canRetryGate, GATE_MESSAGES, type GateBlock } from "../ai_companion/chatGateMessages";
import { SunflowerStageWidget } from "../dashboard/SunflowerStageWidget";
import { formatClock } from "./clockFormat";
import "./PostReadingSheet.css";

export type SavedReading = Extract<SaveResult, { kind: "saved" }>;
type Ready = Extract<PreparedSession, { kind: "ready" }>;

export interface PostReadingSheetProps {
  sessionId: string;
  /** Segundos finales que vio la pantalla: respaldo si el registro aun no los trae. */
  actualSec?: number | null;
  /**
   * "Hablar con Komi": al guardarse la lectura y aceptarla el servidor, abre la charla sin pedir otra
   * vez. Si el servidor no la acepta, la hoja muestra el motivo de siempre.
   */
  autoChat?: boolean;
  service: PostReadingService;
  /** El guardado termino bien: borrar los registros de la sesion y soltar la recarga. */
  onSaved: (result: SavedReading) => void | Promise<void>;
  /** Salida segura sin guardar (sesion descartada o registro perdido). Puede fallar. */
  onDiscard: () => Promise<void>;
  /** La hoja termina: volver al Dashboard. */
  onDone: () => void;
  /** "Si, conversar con Komi": abre la charla de esta sesion ya guardada. */
  onChat: (result: SavedReading) => void;
  /** Sincroniza y dice si el servidor acepto la sesion: solo entonces se ofrece la charla. No rechaza nunca (un fallo es `unsynced`). */
  checkChat: (sessionId: string) => Promise<SessionGate>;
  /** El servidor esta arrancando (plan gratuito): se avisa en lugar de "Sincronizando". */
  waking?: boolean;
}

type ChatGate = { kind: "checking" } | { kind: "ready" } | { kind: "blocked"; block: GateBlock };

type Stage =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "page"; notice: string | null }
  | { kind: "saving"; fraction: number | null }
  | { kind: "error"; message: string }
  | { kind: "discarded" }
  | { kind: "saved"; result: SavedReading };

function errorText(error: unknown): string {
  if (error instanceof KomiLocalError) return `${error.message} Tu sesión sigue a salvo.`;
  return "No pudimos guardar tu lectura. Tu sesión sigue a salvo; inténtalo de nuevo.";
}

export function PostReadingSheet({
  sessionId,
  actualSec = null,
  autoChat = false,
  service,
  onSaved,
  onDiscard,
  onDone,
  onChat,
  checkChat,
  waking = false,
}: PostReadingSheetProps) {
  const [stage, setStage] = useState<Stage>({ kind: "loading" });
  const [prepared, setPrepared] = useState<Ready | null>(null);
  const [page, setPage] = useState("");
  const [leaving, setLeaving] = useState(false);
  const [chatGate, setChatGate] = useState<ChatGate>({ kind: "checking" });
  const [gateAttempt, setGateAttempt] = useState(0);
  const mounted = useRef(false);
  const started = useRef(false);
  const autoOpened = useRef(false);
  const pageId = useId();
  const noticeId = useId();

  const safely = useCallback((update: () => void) => {
    if (mounted.current) update();
  }, []);

  const run = useCallback(
    async (ready: Ready, typedPage?: number) => {
      safely(() => setStage({ kind: "saving", fraction: null }));
      try {
        const result = await service.save(ready, {
          ...(typedPage === undefined ? {} : { page: typedPage }),
          onPreparing: () => safely(() => setStage({ kind: "saving", fraction: 0 })),
          onProgress: (fraction) => safely(() => setStage({ kind: "saving", fraction })),
        });
        if (result.kind === "discarded") {
          safely(() => setStage({ kind: "discarded" }));
          return;
        }
        // Guardado: ahora si se sueltan los registros y la recarga. Si eso falla, la sesion ya esta.
        try {
          await onSaved(result);
        } catch {
          // El registro se limpiara al reabrir (guardar es idempotente por UUID).
        }
        safely(() => setStage({ kind: "saved", result }));
      } catch (error) {
        if (error instanceof InvalidPageError) {
          safely(() => setStage({ kind: "page", notice: error.message }));
          return;
        }
        safely(() => setStage({ kind: "error", message: errorText(error) }));
      }
    },
    [service, onSaved, safely],
  );

  /** Lee el registro y decide el primer paso: pagina (fisico) o guardado directo (EPUB). */
  const begin = useCallback(async () => {
    safely(() => setStage({ kind: "loading" }));
    try {
      const found = await service.prepare(sessionId, actualSec);
      if (found.kind === "missing") {
        safely(() => setStage({ kind: "missing" }));
        return;
      }
      safely(() => {
        setPrepared(found);
        // Se rellena con la ultima pagina guardada (silencio si el lector no avanza).
        setPage((typed) => (typed === "" && found.book.current_page > 0 ? String(found.book.current_page) : typed));
      });
      if (found.book.format_type === "PHYSICAL") safely(() => setStage({ kind: "page", notice: null }));
      else await run(found);
    } catch (error) {
      safely(() => setStage({ kind: "error", message: errorText(error) }));
    }
  }, [service, sessionId, actualSec, run, safely]);

  useEffect(() => {
    mounted.current = true;
    // Con StrictMode el efecto corre dos veces: el guardian evita preparar y guardar por duplicado.
    if (!started.current) {
      started.current = true;
      void begin();
    }
    return () => {
      mounted.current = false;
    };
  }, [begin]);

  const submitPage = () => {
    if (!prepared) return;
    const typed = page.trim() === "" ? Number.NaN : Number(page);
    void run(prepared, typed);
  };

  const retry = () => {
    if (!prepared) {
      void begin();
      return;
    }
    const typed = page.trim() === "" ? undefined : Number(page);
    void run(prepared, typed);
  };

  const exitSafely = async () => {
    setLeaving(true);
    try {
      await onDiscard();
    } catch {
      // No se retiene al lector: el registro se reintentara al reabrir.
    }
    onDone();
  };

  const book = prepared?.book ?? null;
  const total = book?.total_pages ?? null;
  const saved = stage.kind === "saved" ? stage.result : null;

  // Guardada la lectura, se espera al resultado del servidor antes de ofrecer la charla (CU-05).
  useEffect(() => {
    if (saved === null) return undefined;
    let alive = true;
    void checkChat(sessionId).then((gate) => {
      if (!alive) return;
      setChatGate(gate.state === "ready" ? { kind: "ready" } : { kind: "blocked", block: gate.state });
    });
    return () => {
      alive = false;
    };
  }, [saved, sessionId, checkChat, gateAttempt]);

  // Con "Hablar con Komi", la charla se abre en cuanto el servidor acepta la sesion (una sola vez).
  useEffect(() => {
    if (!autoChat || autoOpened.current || saved === null || chatGate.kind !== "ready") return;
    autoOpened.current = true;
    onChat(saved);
  }, [autoChat, saved, chatGate, onChat]);

  const retryGate = () => {
    setChatGate({ kind: "checking" });
    setGateAttempt((value) => value + 1);
  };
  const percentage = saved ? saved.book.progress_percentage : (book?.progress_percentage ?? 0);
  const fallow = saved === null && book?.status === "FALLOW";
  // El girasol solo acompana al resumen en los dos momentos de celebracion (bono solar y florecer).
  const showAura = saved !== null && (saved.solarBonus || saved.bloomed);

  let title = "Tu lectura de hoy";
  if (stage.kind === "page") title = "¿Hasta qué página llegaste?";
  else if (stage.kind === "saving") title = "Guardando tu lectura";
  else if (saved) title = saved.bloomed ? "Tu girasol floreció" : "Sesión terminada";
  else if (stage.kind === "discarded") title = "Sesión sin guardar";
  else if (stage.kind === "missing") title = "No encontramos esta sesión";
  else if (stage.kind === "error") title = "No se pudo guardar";

  // Resumen de la sesion guardada (mockup 05): tiempo leido y avance del libro, "del X % al Y %".
  const from = saved ? Math.floor(saved.before) : 0;
  const to = saved ? Math.floor(saved.book.progress_percentage) : 0;
  const rangeText = from === to ? `Sigues en el ${to} % del libro` : `Del ${from} % al ${to} % del libro`;

  const dismissible = saved !== null;

  return (
    <ZenSheet
      title={title}
      titleVariant={saved ? "label" : "heading"}
      dismissible={dismissible}
      onClose={dismissible ? onDone : () => {}}
    >
      <div className="post-reading">
        {(saved === null || showAura) && (
          <section className="post-reading__canvas" data-block="canvas" aria-label="Tu girasol">
            <div aria-hidden="true">
              <SunflowerStageWidget
                percentage={percentage}
                fallow={fallow}
                solarBonus={showAura}
                size={showAura ? 120 : 140}
              />
            </div>
          </section>
        )}

        {saved && (
          <section className="post-reading__result" data-block="result" aria-label="Resumen de la sesión" role="status">
            <p className="post-reading__time">
              <span className="post-reading__clock tabular">{formatClock(saved.session.actual_duration_sec * 1000)}</span>
              <span className="post-reading__time-label">de lectura</span>
            </p>
            <div
              className="post-reading__bar"
              role="progressbar"
              aria-label="Avance del libro"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={to}
            >
              <div className="post-reading__bar-fill" style={{ width: `${to}%` }} />
            </div>
            <p className="post-reading__range tabular">{rangeText}</p>
            {saved.bloomed && <p className="post-reading__text">Terminaste el libro y tu girasol floreció.</p>}
            {saved.solarBonus && (
              <p className="post-reading__text">
                Bono de Vitalidad Solar: tu constancia cuenta aunque el avance sea pequeño.
              </p>
            )}
          </section>
        )}

        <div className="post-reading__body" data-block="body">
          {stage.kind === "loading" && (
            <p className="post-reading__text" role="status">
              Un momento
            </p>
          )}

          {stage.kind === "page" && (
            <form
              className="post-reading__body"
              onSubmit={(event) => {
                event.preventDefault();
                submitPage();
              }}
            >
              {prepared?.short && (
                <p className="post-reading__text">
                  Llevas menos de 5 minutos. La sesión solo se guarda si llegaste a la última página
                  {total ? ` (${total})` : ""}.
                </p>
              )}
              <div className="post-reading__field">
                <label htmlFor={pageId}>Página alcanzada</label>
                <input
                  id={pageId}
                  className="tabular"
                  value={page}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="off"
                  aria-describedby={stage.notice ? noticeId : undefined}
                  aria-invalid={stage.notice ? true : undefined}
                  onChange={(event) => setPage(event.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
                />
              </div>
              {stage.notice && (
                <p className="post-reading__notice" id={noticeId} role="alert">
                  {stage.notice}
                </p>
              )}
            </form>
          )}

          {stage.kind === "saving" &&
            (stage.fraction === null ? (
              <p className="post-reading__text" role="status">
                Un momento
              </p>
            ) : (
              <PreparationProgress fraction={stage.fraction} />
            ))}

          {stage.kind === "error" && (
            <p className="post-reading__notice" role="alert">
              {stage.message}
            </p>
          )}

          {stage.kind === "missing" && (
            <p className="post-reading__text">
              No pudimos recuperar los datos de esta lectura. El avance que ya tenías sigue intacto.
            </p>
          )}

          {stage.kind === "discarded" && (
            <p className="post-reading__text">
              Leíste menos de 5 minutos y no llegaste a la última página, así que esta sesión
              no se guardó. Tu avance anterior sigue intacto.
            </p>
          )}

          {saved && !(autoChat && chatGate.kind !== "blocked") && (
            <p className="post-reading__question">¿Quieres charlar un poco sobre lo que acabas de leer?</p>
          )}
          {saved && chatGate.kind === "checking" && (
            <p className="post-reading__text" role="status">
              {waking ? "Despertando a Komi" : "Sincronizando tu sesión"}
            </p>
          )}
          {saved && chatGate.kind === "blocked" && (
            <p className="post-reading__text" role="status">
              {GATE_MESSAGES[chatGate.block]}
            </p>
          )}
        </div>

        <div className="post-reading__actions" data-block="actions">
          {stage.kind === "page" && (
            <ZenPrimaryButton disabled={page.trim() === ""} onClick={submitPage}>
              Actualizar Girasol
            </ZenPrimaryButton>
          )}
          {stage.kind === "error" && <ZenPrimaryButton onClick={retry}>Reintentar</ZenPrimaryButton>}
          {(stage.kind === "discarded" || stage.kind === "missing") && (
            <ZenPrimaryButton disabled={leaving} onClick={() => void exitSafely()}>
              Volver al jardín
            </ZenPrimaryButton>
          )}
          {saved && (
            <>
              <ZenPrimaryButton disabled={chatGate.kind !== "ready"} onClick={() => onChat(saved)}>
                Sí, conversar con Komi
              </ZenPrimaryButton>
              {chatGate.kind === "blocked" && canRetryGate(chatGate.block) && (
                <ZenPrimaryButton variant="secondary" onClick={retryGate}>
                  Reintentar
                </ZenPrimaryButton>
              )}
              <ZenPrimaryButton variant="secondary" onClick={onDone}>
                Por hoy no, volver al jardín
              </ZenPrimaryButton>
            </>
          )}
        </div>
      </div>
    </ZenSheet>
  );
}
