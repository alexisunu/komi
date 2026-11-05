// Fin del onboarding (CU-01, pasos 3 y 4): calcula el plan en local con el algoritmo compartido,
// guarda el perfil en Dexie y deja el POST /profile/onboarding/ en cola, todo en UNA transaccion.
// Primero lo local: la red nunca se toca aqui (SRS 18, punto 11).

import { getDatabase, type KomiDatabase } from "../data/local_db/dexieDatabase";
import { InvalidProfileError } from "../data/local_db/errors";
import { createLocalMetaRepository, META_KEYS } from "../data/local_db/localMetaRepository";
import {
  createLocalProfileRepository,
  type LocalProfileRepository,
} from "../data/local_db/localProfileRepository";
import { systemClock, type LocalClock } from "../data/local_db/localBookRepository";
import { isUuid } from "../data/local_db/sessionRules";
import { guardStorage } from "../data/local_db/storageGuard";
import type { LocalProfile } from "../data/local_db/types";
import {
  calculateHabitPlan,
  isCompleteAnswers,
  type HabitPlan,
  type OnboardingAnswers,
} from "./habitPlan";

export interface CompleteOnboardingResult {
  profile: LocalProfile;
  plan: HabitPlan;
  /** Falso si ya existia un perfil: se devuelve sin modificarlo y sin encolar nada. */
  created: boolean;
}

export function createOnboardingService(
  db: KomiDatabase = getDatabase(),
  clock: LocalClock = systemClock,
  profiles: LocalProfileRepository = createLocalProfileRepository(db, clock),
) {
  const meta = createLocalMetaRepository(db);

  return {
    async completeOnboarding(input: {
      profile_id: string;
      answers: OnboardingAnswers;
    }): Promise<CompleteOnboardingResult> {
      if (!isUuid(input.profile_id)) {
        throw new InvalidProfileError("profile_id", "El profile_id debe ser un UUID.");
      }
      if (!isCompleteAnswers(input.answers)) {
        throw new InvalidProfileError("answers", "Faltan respuestas del cuestionario.");
      }
      const plan = calculateHabitPlan(input.answers);

      return guardStorage(() =>
        db.transaction("rw", db.profile, db.meta, async () => {
          // Un perfil previo (doble toque, otra pestana) gana: se devuelve tal cual y no se
          // encola ningun POST que lo contradiga.
          const existing = await profiles.getProfile();
          if (existing) {
            const current: HabitPlan = {
              daily_goal_minutes: existing.daily_goal_minutes,
              preferred_moment: existing.preferred_moment,
              ai_reflection_style: existing.ai_reflection_style,
              preconfigure_tsukimi: existing.preconfigure_tsukimi ?? false,
            };
            return { profile: existing, plan: current, created: false };
          }
          const profile = await profiles.createProfile({
            profile_id: input.profile_id,
            daily_goal_minutes: plan.daily_goal_minutes,
            preferred_moment: plan.preferred_moment,
            ai_reflection_style: plan.ai_reflection_style,
            preconfigure_tsukimi: plan.preconfigure_tsukimi,
          });
          await meta.set(
            META_KEYS.onboardingPending,
            JSON.stringify({ profile_id: input.profile_id, answers: input.answers }),
          );
          return { profile, plan, created: true };
        }),
      );
    },
  };
}

export type OnboardingService = ReturnType<typeof createOnboardingService>;
