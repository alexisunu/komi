// Pantalla de concentracion del libro fisico (CU-03, paso 4; FA-3.1 a FA-3.3). Sin navegacion
// inferior: el girasol respirando, el reloj y una sola accion. Tres bloques funcionales; el aviso
// de gracia solo aparece mientras la pagina esta en segundo plano.

import { useState } from "react";
import { ZenPrimaryButton } from "../../core/components/ZenPrimaryButton";
import { ZenSheet } from "../../core/components/ZenSheet";
import type { LocalBook } from "../../data/local_db/types";
import type { FocusSnapshot, FocusVisibilityService } from "../../services/focusVisibilityService";
import type { WakeLockService } from "../../services/wakeLockService";
import { SunflowerStageWidget } from "../dashboard/SunflowerStageWidget";
import { sessionClock, sessionSubtitle } from "./clockFormat";
import { GracePeriodBanner } from "./GracePeriodBanner";
import "./PhysicalTimerScreen.css";
import { useWakeLock } from "./useWakeLock";

export interface PhysicalTimerScreenProps {
  book: LocalBook | null;
  /** Solo se muestra en las fases `running` y `grace`. */
  snapshot: FocusSnapshot;
  wakeLock: WakeLockService;
  peekFinish: FocusVisibilityService["peekFinish"];
  /** Cierra la sesion con el tiempo leido (5 minutos o mas, o el lector dice que termino el libro). */
  onFinish: () => void;
  /** Descartar sin guardar nada. */
  onCancel: () => void | Promise<void>;
}

export function PhysicalTimerScreen({
  book,
  snapshot,
  wakeLock,
  peekFinish,
  onFinish,
  onCancel,
}: PhysicalTimerScreenProps) {
  const [confirming, setConfirming] = useState(false);
  const inGrace = snapshot.phase === "grace";

  useWakeLock(wakeLock, true);

  // Regla unica (FA-3.3): con 5 minutos se guarda directo; con menos, aviso.
  const finishSession = () => {
    if (peekFinish()?.enough) onFinish();
    else setConfirming(true);
  };

  // Descartar es explicito: no guarda nada aunque el tiempo siga corriendo con el aviso abierto.
  const discard = () => {
    setConfirming(false);
    void onCancel();
  };

  // En un libro fisico no se sabe si se termino hasta pedir la pagina: la hoja de cierre la pide y
  // solo guarda si es la ultima.
  const finishBook = () => {
    setConfirming(false);
    onFinish();
  };

  return (
    <div className="focus-timer">
      <section className="focus-timer__canvas" data-block="canvas" aria-label="Libro en lectura">
        <SunflowerStageWidget
          percentage={book?.progress_percentage ?? 0}
          size={200}
          breathing
          breathingPaused={inGrace}
        />
        {book && <h1 className="focus-timer__title">{book.title}</h1>}
      </section>

      <div className="focus-timer__middle" data-block="clock">
        <output
          className="focus-timer__clock tabular"
          role="timer"
          aria-label={snapshot.timerType === "FREE" ? "Tiempo leído" : "Tiempo restante"}
        >
          {sessionClock(snapshot)}
        </output>
        <p className="focus-timer__mode tabular">
          {sessionSubtitle(snapshot.timerType, book ? book.progress_percentage : null)}
        </p>
        {inGrace && <GracePeriodBanner variant="grace" graceRemainingMs={snapshot.graceRemainingMs} />}
      </div>

      <div className="focus-timer__actions" data-block="actions">
        <ZenPrimaryButton variant="secondary" onClick={finishSession}>
          Terminar sesión
        </ZenPrimaryButton>
      </div>

      {confirming && (
        <ZenSheet title="¿Terminar sin guardar?" onClose={() => setConfirming(false)}>
          <p className="focus-timer__confirm-text">
            El tiempo mínimo es 5 min. Si terminas ahora, la sesión no se guarda y no se registra
            ningún avance, salvo que hayas terminado el libro: en ese caso se guarda si indicas la
            última página.
          </p>
          <div className="focus-timer__confirm-actions">
            <ZenPrimaryButton onClick={() => setConfirming(false)}>Seguir leyendo</ZenPrimaryButton>
            <ZenPrimaryButton variant="secondary" onClick={finishBook}>
              Terminé el libro
            </ZenPrimaryButton>
            <ZenPrimaryButton variant="secondary" onClick={discard}>
              Descartar
            </ZenPrimaryButton>
          </div>
        </ZenSheet>
      )}
    </div>
  );
}
