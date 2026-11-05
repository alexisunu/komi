import type { ThemeId } from "./colorTokens";

export interface ThemeResolutionInput {
  /** Eleccion manual del lector guardada localmente (interruptor de Ajustes). */
  storedMode: ThemeId | null;
  /** `preconfigure_tsukimi` del onboarding (SRS 18, punto 6); null si no se calculo. */
  preconfigureTsukimi: boolean | null;
  systemPrefersDark: boolean;
}

/** Orden: eleccion manual, luego el onboarding, luego el sistema. */
export function resolveTheme(input: ThemeResolutionInput): ThemeId {
  if (input.storedMode) return input.storedMode;
  if (input.preconfigureTsukimi === true) return "dark";
  return input.systemPrefersDark ? "dark" : "light";
}
