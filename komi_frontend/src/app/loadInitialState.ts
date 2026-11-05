import type { LocalBook, LocalProfile } from "../data/local_db/types";
import { pickActiveBook } from "../features/dashboard/activeBook";
import type { AppDeps } from "./appDeps";

export const STORAGE_WARNING =
  "Este navegador no permite guardar datos en el dispositivo. Komi los necesita para funcionar sin conexión.";

export type InitialState =
  | { status: "onboarding"; storageWarning: string | null }
  | { status: "ready"; profile: LocalProfile; streakDays: number; book: LocalBook | null };

/**
 * Lee el perfil de Dexie: sin perfil, onboarding; con perfil, Dashboard. Si IndexedDB falla se
 * entra al onboarding con un aviso (guardar fallara con su propio mensaje). Libros y racha son
 * secundarios: si fallan, el Dashboard se muestra vacio en lugar de bloquearse.
 */
export async function loadInitialState(deps: Pick<AppDeps, "profiles" | "meta" | "books">): Promise<InitialState> {
  let profile: LocalProfile | undefined;
  try {
    profile = await deps.profiles.getProfile();
  } catch {
    return { status: "onboarding", storageWarning: STORAGE_WARNING };
  }
  if (!profile) return { status: "onboarding", storageWarning: null };

  const [streakDays, book] = await Promise.all([
    deps.meta.getStreakCurrent().catch(() => 0),
    deps.books
      .listBooks({ statuses: ["ACTIVE", "GROWING", "FALLOW"] })
      .then(pickActiveBook)
      .catch(() => null),
  ]);
  return { status: "ready", profile, streakDays, book };
}
