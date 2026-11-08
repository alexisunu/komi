import { getDatabase, type KomiDatabase } from "./dexieDatabase";
import { InvalidProfileError } from "./errors";
import { systemClock, type LocalClock } from "./localBookRepository";
import { isUuid } from "./sessionRules";
import { guardStorage } from "./storageGuard";
import type { AiReflectionStyle, LocalProfile, PreferredMoment, ThemeMode } from "./types";

export const PROFILE_ROW_ID = "local" as const;
export const PROFILE_ID_STORAGE_KEY = "komi.profile_id";

export interface SaveProfileInput {
  profile_id: string;
  daily_goal_minutes: number;
  preferred_moment: PreferredMoment;
  ai_reflection_style: AiReflectionStyle;
  preconfigure_tsukimi?: boolean | null | undefined;
}

export interface ProfilePatch {
  theme_mode?: ThemeMode | null;
  daily_goal_minutes?: number;
  preferred_moment?: PreferredMoment;
  ai_reflection_style?: AiReflectionStyle;
  onboarding_synced?: boolean;
}

/** Copia del profile_id en localStorage (SRS 18, punto 8). Es un respaldo: si falla, se ignora. */
export function mirrorProfileId(profileId: string, storage: Pick<Storage, "setItem"> | undefined): void {
  try {
    storage?.setItem(PROFILE_ID_STORAGE_KEY, profileId);
  } catch {
    // Modo privado o cuota llena: IndexedDB sigue siendo la fuente.
  }
}

export function defaultStorage(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined; // acceder a localStorage puede lanzar SecurityError
  }
}

export function createLocalProfileRepository(
  db: KomiDatabase = getDatabase(),
  clock: LocalClock = systemClock,
  storage: Pick<Storage, "setItem"> | undefined = defaultStorage(),
) {
  return {
    getProfile(): Promise<LocalProfile | undefined> {
      return guardStorage(() => db.profile.get(PROFILE_ROW_ID));
    },

    /**
     * Crea el perfil local (fin del onboarding). Si ya existe lo devuelve sin modificarlo: el
     * UUID del lector no se reemplaza por accidente.
     */
    async createProfile(input: SaveProfileInput): Promise<LocalProfile> {
      if (!isUuid(input.profile_id)) {
        throw new InvalidProfileError("profile_id", "El profile_id debe ser un UUID.");
      }
      return guardStorage(() =>
        db.transaction("rw", db.profile, async () => {
          const existing = await db.profile.get(PROFILE_ROW_ID);
          if (existing) return existing;
          const stamp = clock.now().toISOString();
          const profile: LocalProfile = {
            id: PROFILE_ROW_ID,
            profile_id: input.profile_id,
            daily_goal_minutes: input.daily_goal_minutes,
            preferred_moment: input.preferred_moment,
            ai_reflection_style: input.ai_reflection_style,
            theme_mode: null,
            preconfigure_tsukimi: input.preconfigure_tsukimi ?? null,
            onboarding_synced: false,
            created_at: stamp,
            updated_at: stamp,
          };
          await db.profile.add(profile);
          mirrorProfileId(profile.profile_id, storage);
          return profile;
        }),
      );
    },

    /** Ajustes locales (tema, meta, estilo). Solo escribe si algo cambia. */
    updateProfile(patch: ProfilePatch): Promise<LocalProfile | undefined> {
      return guardStorage(() =>
        db.transaction("rw", db.profile, async () => {
          const profile = await db.profile.get(PROFILE_ROW_ID);
          if (!profile) return undefined;
          const next: LocalProfile = { ...profile, ...patch };
          const changed = (Object.keys(patch) as Array<keyof ProfilePatch>).some(
            (key) => next[key] !== profile[key],
          );
          if (!changed) return profile;
          next.updated_at = clock.now().toISOString();
          await db.profile.put(next);
          return next;
        }),
      );
    },
  };
}

export type LocalProfileRepository = ReturnType<typeof createLocalProfileRepository>;
