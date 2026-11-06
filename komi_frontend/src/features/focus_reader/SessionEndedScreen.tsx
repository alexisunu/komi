// Pantalla PROVISIONAL "Sesión terminada" (SRS 19.15). La sustituye PostReadingSheet en el bloque 6.
// Hasta entonces las sesiones terminadas NO se guardan: el unico boton borra `active_session`
// (via `onLeave`) para que reabrir la app no vuelva aqui en bucle. Nunca deja al lector atrapado:
// el boton siempre sale, aunque Dexie falle al borrar el registro.

import { useState } from "react";
import { ZenPrimaryButton } from "../../core/components/ZenPrimaryButton";
import type { LocalBook } from "../../data/local_db/types";
import { SunflowerStageWidget } from "../dashboard/SunflowerStageWidget";
import "./SessionEndedScreen.css";

export interface SessionEndedScreenProps {
  book: LocalBook | null;
  /** Minutos leidos (redondeados hacia abajo). */
  minutesRead: number;
  /** Borra la sesion y vuelve a la app. Puede fallar: la pantalla se cierra de todos modos. */
  onLeave: () => Promise<void>;
}

export function SessionEndedScreen({ book, minutesRead, onLeave }: SessionEndedScreenProps) {
  const [leaving, setLeaving] = useState(false);

  const leave = () => {
    setLeaving(true);
    onLeave().catch(() => {
      // El registro se reintentara al reabrir; aqui no se retiene al lector.
    });
  };

  return (
    <div className="session-ended">
      <section className="session-ended__canvas" data-block="canvas" aria-label="Sesión terminada">
        <SunflowerStageWidget percentage={book?.progress_percentage ?? 0} size={160} />
        <h1 className="session-ended__title">Sesión terminada</h1>
        <p className="session-ended__text">
          Leíste {minutesRead} {minutesRead === 1 ? "minuto" : "minutos"}. En esta versión la sesión
          todavía no se guarda.
        </p>
      </section>
      <div className="session-ended__actions" data-block="actions">
        <ZenPrimaryButton disabled={leaving} onClick={leave}>
          Volver al jardín
        </ZenPrimaryButton>
      </div>
    </div>
  );
}
