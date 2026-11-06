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
import { formatClock } from "./clockFormat";
import { GracePeriodBanner } from "./GracePeriodBanner";
import "./PhysicalTimerScreen.css";
import { useWakeLock } from "./useWakeLock";

export interface PhysicalTimerScreenProps {
  book: LocalBook | null;
  /** Solo se muestra en las fases `running` y `grace`. */
  snapshot: FocusSnapshot;
  wakeLock: WakeLockService;
  peekEarlyFinish: FocusVisibilityService["peekEarlyFinish"];
  /** El 50 % o mas: la sesion queda como terminada antes de tiempo, valida. */
  onAcceptEarly: () => void;
  /** Cancelar sin guardar nada (menos del 50 %, ya confirmado). */
  onCancel: () => void | Promise<void>;
}

export function PhysicalTimerScreen({
  book,
  snapshot,
  wakeLock,
  peekEarlyFinish,
  onAcceptEarly,
  onCancel,
}: PhysicalTimerScreenProps) {
  const [confirming, setConfirming] = useState(false);
  const inGrace = snapshot.phase === "grace";

  useWakeLock(wakeLock, true);

  const finishEarly = () => {
    const early = peekEarlyFinish();
    if (early && !early.belowHalf) onAcceptEarly();
    else setConfirming(true);
  };

  // El tiempo siguio corriendo con la hoja abierta: si ya se paso del 50 %, es una sesion valida.
  const confirmCancel = () => {
    setConfirming(false);
    const early = peekEarlyFinish();
    if (early && !early.belowHalf) onAcceptEarly();
    else void onCancel();
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
        <output className="focus-timer__clock tabular" role="timer" aria-label="Tiempo restante">
          {formatClock(snapshot.remainingMs)}
        </output>
        {inGrace && <GracePeriodBanner variant="grace" graceRemainingMs={snapshot.graceRemainingMs} />}
      </div>

      <div className="focus-timer__actions" data-block="actions">
        <ZenPrimaryButton variant="secondary" onClick={finishEarly}>
          Terminé antes de tiempo
        </ZenPrimaryButton>
      </div>

      {confirming && (
        <ZenSheet title="¿Terminar sin guardar?" onClose={() => setConfirming(false)}>
          <p className="focus-timer__confirm-text">
            Llevas menos de la mitad del tiempo que programaste. Si terminas ahora, la sesión se
            cancela y no se guarda ningún avance.
          </p>
          <div className="focus-timer__confirm-actions">
            <ZenPrimaryButton onClick={() => setConfirming(false)}>Seguir leyendo</ZenPrimaryButton>
            <ZenPrimaryButton variant="secondary" onClick={confirmCancel}>
              Cancelar sesión
            </ZenPrimaryButton>
          </div>
        </ZenSheet>
      )}
    </div>
  );
}
