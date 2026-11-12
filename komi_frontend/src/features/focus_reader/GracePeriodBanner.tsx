// Alerta gentil en Terracota con la cuenta de los 15 s del periodo de gracia (FA-3.1). El aviso de
// la sesion invalidada (FA-3.2) es una hoja modal en App.tsx, no un banner.

import { Clock } from "lucide-react";
import "./GracePeriodBanner.css";

export interface GraceBannerProps {
  variant: "grace";
  graceRemainingMs: number;
}

export function GracePeriodBanner(props: GraceBannerProps) {
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
