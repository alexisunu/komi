// Hook de la sesion de lectura: une el servicio del temporizador con React y con la puerta de
// recarga del Service Worker (reloadGate). Mientras dura la sesion (corriendo, en gracia, hoja
// post-lectura y chat) se aplaza cualquier recarga; se libera una sola vez en `leave()` o al
// desmontar.

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReloadGate } from "../../pwa/reloadGate";
import type {
  FocusSnapshot,
  FocusVisibilityService,
  StartInput,
} from "../../services/focusVisibilityService";

/** Cada cuanto se relee el reloj para repintar. No cuenta nada: solo pregunta la hora. */
export const REPAINT_MS = 250;

export interface UseFocusSession {
  snapshot: FocusSnapshot | null;
  start(input: StartInput): Promise<void>;
  /** "Terminar sesión": segundos y si ya hay 5 minutos. */
  peekFinish: FocusVisibilityService["peekFinish"];
  acceptFinish(): void;
  /** Sale de la sesion (guardada, cancelada o descartada): borra el registro y suelta la recarga. */
  leave(): Promise<void>;
}

export function useFocusSession(service: FocusVisibilityService, gate: ReloadGate): UseFocusSession {
  const [snapshot, setSnapshot] = useState<FocusSnapshot | null>(service.getSnapshot());
  const release = useRef<(() => void) | null>(null);

  const hold = useCallback(() => {
    release.current ??= gate.block();
  }, [gate]);

  const drop = useCallback(() => {
    release.current?.();
    release.current = null;
  }, []);

  useEffect(() => {
    const unsubscribe = service.subscribe(() => setSnapshot(service.getSnapshot()));
    let alive = true;
    void service.recover().then((recovered) => {
      if (!alive || !recovered) return;
      // Una sesion retomada (incluso ya terminada y sin guardar) sigue protegida de recargas.
      if (recovered.phase !== "invalidated") hold();
      setSnapshot(recovered);
    });
    return () => {
      alive = false;
      unsubscribe();
      service.dispose();
      drop();
    };
  }, [service, hold, drop]);

  const phase = snapshot?.phase;

  // Una sesion invalidada ya quedo guardada: no hay nada que proteger de una recarga.
  useEffect(() => {
    if (phase === "invalidated") drop();
  }, [phase, drop]);

  useEffect(() => {
    if (phase !== "running" && phase !== "grace") return;
    const id = window.setInterval(() => void service.tick(), REPAINT_MS);
    return () => window.clearInterval(id);
  }, [service, phase]);

  const start = useCallback(
    async (input: StartInput) => {
      hold();
      try {
        await service.start(input);
      } catch (error) {
        drop();
        throw error;
      }
    },
    [service, hold, drop],
  );

  const leave = useCallback(async () => {
    try {
      await service.close();
    } finally {
      drop();
    }
  }, [service, drop]);

  return {
    snapshot,
    start,
    peekFinish: () => service.peekFinish(),
    acceptFinish: () => {
      service.acceptFinish();
    },
    leave,
  };
}
