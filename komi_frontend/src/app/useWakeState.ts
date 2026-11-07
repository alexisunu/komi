import { useSyncExternalStore } from "react";
import type { WakeService, WakeState } from "../data/network/wakeService";

/** Estado del despertar del servidor, para mostrar "Despertando a Komi" mientras tarda. */
export function useWakeState(wake: Pick<WakeService, "state" | "subscribe">): WakeState {
  return useSyncExternalStore(wake.subscribe, wake.state);
}
