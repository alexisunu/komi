// Mantiene la pantalla encendida mientras `active` sea verdadero (SRS 19.12).

import { useEffect } from "react";
import type { WakeLockService } from "../../services/wakeLockService";

export function useWakeLock(service: WakeLockService, active: boolean): void {
  useEffect(() => {
    if (!active) return undefined;
    void service.acquire();
    return () => {
      void service.release();
    };
  }, [service, active]);
}
