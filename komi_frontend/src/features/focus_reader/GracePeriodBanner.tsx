// Alerta gentil en Terracota del periodo de gracia (FA-3.1, FA-3.2). Dos variantes: la cuenta de
// los 15 s de la salida en curso y el aviso al volver cuando la sesion se invalido.

import { Clock, CircleAlert } from "lucide-react";
import "./GracePeriodBanner.css";

export type GraceBannerProps =
  | { variant: "grace"; graceRemainingMs: number }
  | { variant: "invalidated" };

export function GracePeriodBanner(props: GraceBannerProps) {
  if (props.variant === "invalidated") {
    return (
      <div className="grace-banner" role="alert">
        <CircleAlert className="grace-banner__icon" size={20} strokeWidth={1.75} aria-hidden="true" />
        <p className="grace-banner__text">
          Saliste de la lectura más de 15 segundos y la sesión no se guardó como válida. Tu avance
          anterior sigue a salvo.
        </p>
      </div>
    );
  }
  const seconds = Math.max(0, Math.ceil(props.graceRemainingMs / 1000));
  return (
    <div className="grace-banner" role="status">
      <Clock className="grace-banner__icon" size={20} strokeWidth={1.75} aria-hidden="true" />
      <p className="grace-banner__text">
        Vuelve a tu lectura en <span className="grace-banner__count">{seconds} s</span> para que
        la sesión siga válida.
      </p>
    </div>
  );
}
