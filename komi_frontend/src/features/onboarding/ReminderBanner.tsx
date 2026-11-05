import { CalendarPlus } from "lucide-react";
import { ZenPrimaryButton } from "../../core/components/ZenPrimaryButton";
import { ICON_STROKE_WIDTH } from "../../core/theme/geometryTokens";
import type { PreferredMoment } from "../../data/local_db/types";
import { REMINDER_TIMES } from "../../services/calendarReminderService";
import "./ReminderBanner.css";

/** Hora del recordatorio en 24 h ("07:30", "15:00", "21:30", "12:30"), como el .ics. */
export function formatReminderTime(moment: PreferredMoment): string {
  const { hour, minute } = REMINDER_TIMES[moment];
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export type ReminderState = "offer" | "added" | "dismissed";

interface ReminderBannerProps {
  timeLabel: string;
  state: ReminderState;
  /** Mensaje si no se pudo preparar el archivo. */
  error: string | null;
  onAdd: () => void;
  onDismiss: () => void;
}

const ICON_SIZE = 20;

/**
 * Banner amable del recordatorio (CU-01, paso 4). La descarga del .ics sale de un toque del
 * lector, que es lo que iOS exige. "Ahora no" lo retira sin insistir.
 */
export function ReminderBanner({ timeLabel, state, error, onAdd, onDismiss }: ReminderBannerProps) {
  if (state === "dismissed") return null;
  return (
    <section className="reminder-banner" aria-labelledby="reminder-title" data-block="reminder">
      <div className="reminder-banner__header">
        <CalendarPlus
          className="reminder-banner__icon"
          size={ICON_SIZE}
          strokeWidth={ICON_STROKE_WIDTH}
          aria-hidden="true"
        />
        <h2 className="reminder-banner__title" id="reminder-title">
          Recordatorio diario
        </h2>
      </div>
      {state === "added" ? (
        <p className="reminder-banner__text" role="status">
          Listo. Abre el archivo descargado para añadir el recordatorio a tu calendario.
        </p>
      ) : (
        <>
          <p className="reminder-banner__text">
            Añade un recordatorio a tu calendario para leer cada día a las {timeLabel}.
          </p>
          {error && (
            <p className="reminder-banner__error" role="alert">
              {error}
            </p>
          )}
          <div className="reminder-banner__actions">
            <ZenPrimaryButton variant="secondary" onClick={onAdd}>
              Añadir al calendario
            </ZenPrimaryButton>
            <button type="button" className="reminder-banner__dismiss" onClick={onDismiss}>
              Ahora no
            </button>
          </div>
        </>
      )}
    </section>
  );
}
