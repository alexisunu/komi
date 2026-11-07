// Despertar del servidor inerte para pruebas que cuentan las llamadas a fetch o no tratan del
// arranque en frio: no sondea, siempre esta despierto.
import type { WakeService, WakeState } from "../data/network/wakeService";

export const noWake: WakeService = {
  state: () => "idle",
  subscribe: () => () => {},
  start: async () => {},
  ensureAwake: async () => true,
};

/** Despertar controlable: el estado se fija a mano y `ensureAwake` puede quedar retenido. */
export function createFakeWake() {
  let current: WakeState = "idle";
  let held: Promise<boolean> | null = null;
  const listeners = new Set<() => void>();
  const wake: WakeService = {
    state: () => current,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start: async () => {},
    ensureAwake: async () => (held ? held : true),
  };
  return {
    wake,
    set(next: WakeState) {
      current = next;
      for (const listener of [...listeners]) listener();
    },
    /** Las proximas llamadas a `ensureAwake` esperan a esta promesa. */
    hold(promise: Promise<boolean>) {
      held = promise;
    },
  };
}
