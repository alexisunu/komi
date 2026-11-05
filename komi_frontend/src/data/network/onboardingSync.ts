// Cola del POST /profile/onboarding/ (SRS 18, puntos 8 y 11; SRS 17, punto 15).
//
// El perfil ya esta guardado en Dexie y las respuestas esperan en `meta.onboarding_pending`.
// Aqui se intenta enviarlas y se aplica lo que responda el servidor: si devuelve otra meta,
// prevalece la del servidor con una actualizacion silenciosa. Safari no tiene Background Sync,
// por eso se reintenta al abrir la app y al volver la red (`watchOnboardingSync`).
//
// Un rechazo permanente (4xx) NO borra la cola: se conserva `onboarding_pending`, se guarda el
// error y se registra en consola. No se reintenta solo (el mismo cuerpo no va a cambiar de
// respuesta); `flush({ retryRejected: true })` lo fuerza. El UUID no se escribe en logs.

import { getDatabase, type KomiDatabase } from "../local_db/dexieDatabase";
import { createLocalMetaRepository, META_KEYS } from "../local_db/localMetaRepository";
import {
  createLocalProfileRepository,
  type LocalProfileRepository,
} from "../local_db/localProfileRepository";
import type { AiReflectionStyle, PreferredMoment } from "../local_db/types";
import { isCompleteAnswers, type OnboardingAnswers } from "../../services/habitPlan";
import { ApiError, getApiClient, type ApiClient } from "./apiClient";

export const ONBOARDING_PATH = "/profile/onboarding/";

const MOMENTS: readonly PreferredMoment[] = ["MORNING", "AFTERNOON", "NIGHT", "COMMUTE"];
const STYLES: readonly AiReflectionStyle[] = ["MEMORY_QUIZ", "DEEP_ANALYSIS", "KEY_SUMMARY"];

export interface PendingOnboarding {
  profile_id: string;
  answers: OnboardingAnswers;
}

export interface OnboardingResponse {
  profile_id: string;
  daily_goal_minutes: number;
  preferred_moment: PreferredMoment;
  ai_reflection_style: AiReflectionStyle;
  preconfigure_tsukimi: boolean | null;
}

export function parseOnboardingResponse(data: unknown): OnboardingResponse | null {
  if (typeof data !== "object" || data === null) return null;
  const r = data as Record<string, unknown>;
  const goal = r["daily_goal_minutes"];
  if (typeof goal !== "number" || !Number.isInteger(goal) || goal < 1 || goal > 1440) return null;
  if (!MOMENTS.includes(r["preferred_moment"] as PreferredMoment)) return null;
  if (!STYLES.includes(r["ai_reflection_style"] as AiReflectionStyle)) return null;
  if (typeof r["profile_id"] !== "string") return null;
  return {
    profile_id: r["profile_id"],
    daily_goal_minutes: goal,
    preferred_moment: r["preferred_moment"] as PreferredMoment,
    ai_reflection_style: r["ai_reflection_style"] as AiReflectionStyle,
    preconfigure_tsukimi: typeof r["preconfigure_tsukimi"] === "boolean" ? r["preconfigure_tsukimi"] : null,
  };
}

function parsePending(raw: unknown): PendingOnboarding | null {
  if (typeof raw !== "string") return null;
  try {
    const value = JSON.parse(raw) as { profile_id?: unknown; answers?: unknown };
    if (typeof value.profile_id !== "string" || !isCompleteAnswers(value.answers)) return null;
    return { profile_id: value.profile_id, answers: value.answers };
  } catch {
    return null;
  }
}

export type FlushStatus =
  | "nothing" // no hay nada en cola
  | "synced" // el servidor confirmo; la cola quedo vacia
  | "retry_later" // sin red, tiempo agotado, 429 o 5xx: la cola se conserva
  | "rejected" // 4xx permanente: la cola se conserva y el error queda registrado
  | "skipped_rejected" // ya hubo un rechazo permanente y no se fuerza
  | "not_configured"; // sin VITE_API_URL valida

export interface FlushResult {
  status: FlushStatus;
  /** El perfil local cambio (la meta del servidor difiere o se marco como sincronizado). */
  profileUpdated: boolean;
}

export interface OnboardingSyncOptions {
  db?: KomiDatabase;
  api?: ApiClient;
  profiles?: LocalProfileRepository;
  /** En desarrollo se avisa en consola si el servidor responde otra meta (SRS 18, punto 11). */
  warnOnMismatch?: boolean;
  log?: Pick<Console, "warn" | "error">;
  now?: () => Date;
}

export function createOnboardingSync(options: OnboardingSyncOptions = {}) {
  const db = options.db ?? getDatabase();
  const api = options.api ?? getApiClient();
  const profiles = options.profiles ?? createLocalProfileRepository(db);
  const meta = createLocalMetaRepository(db);
  const log = options.log ?? console;
  const now = options.now ?? (() => new Date());
  let inFlight: Promise<FlushResult> | null = null;

  async function recordRejection(kind: string, status: number | null): Promise<void> {
    await meta.set(
      META_KEYS.onboardingError,
      JSON.stringify({ kind, status, at: now().toISOString() }),
    );
    log.error(
      `El servidor rechazo el onboarding de forma permanente (${kind}, codigo ${status ?? "ninguno"}). ` +
        "Se conserva la cola en onboarding_pending.",
    );
  }

  async function run(retryRejected: boolean): Promise<FlushResult> {
    const rawPending = await meta.get(META_KEYS.onboardingPending);
    if (rawPending === undefined || rawPending === null) {
      return { status: "nothing", profileUpdated: false };
    }
    if (!retryRejected && (await meta.get(META_KEYS.onboardingError)) !== undefined) {
      return { status: "skipped_rejected", profileUpdated: false };
    }
    if (!api.isConfigured) return { status: "not_configured", profileUpdated: false };

    const pending = parsePending(rawPending);
    if (!pending) {
      await recordRejection("corrupt_pending", null);
      return { status: "rejected", profileUpdated: false };
    }

    let response: OnboardingResponse | null;
    try {
      const result = await api.post<unknown>(ONBOARDING_PATH, {
        body: { profile_id: pending.profile_id, answers: pending.answers },
        profileId: pending.profile_id,
      });
      response = parseOnboardingResponse(result.data);
      if (!response) {
        throw new ApiError("invalid_response", "Respuesta de onboarding inesperada.", result.status, true);
      }
    } catch (error) {
      if (error instanceof ApiError && !error.retryable) {
        await recordRejection(error.kind, error.status);
        return { status: "rejected", profileUpdated: false };
      }
      return { status: "retry_later", profileUpdated: false };
    }

    // El servidor manda: se aplica su meta, momento y estilo y se marca el perfil como sincronizado.
    const local = await profiles.getProfile();
    let profileUpdated = false;
    if (local && local.profile_id === pending.profile_id) {
      const differs =
        local.daily_goal_minutes !== response.daily_goal_minutes ||
        local.preferred_moment !== response.preferred_moment ||
        local.ai_reflection_style !== response.ai_reflection_style;
      if (differs && options.warnOnMismatch) {
        log.warn(
          `El servidor devolvio otro plan de habito: meta local ${local.daily_goal_minutes} min, ` +
            `servidor ${response.daily_goal_minutes} min. Prevalece el del servidor.`,
        );
      }
      await profiles.updateProfile({
        daily_goal_minutes: response.daily_goal_minutes,
        preferred_moment: response.preferred_moment,
        ai_reflection_style: response.ai_reflection_style,
        onboarding_synced: true,
      });
      profileUpdated = differs || !local.onboarding_synced;
    }
    await meta.remove(META_KEYS.onboardingPending);
    await meta.remove(META_KEYS.onboardingError);
    return { status: "synced", profileUpdated };
  }

  return {
    /** Intenta enviar la cola. Llamadas simultaneas comparten una sola peticion. */
    flush(flushOptions: { retryRejected?: boolean } = {}): Promise<FlushResult> {
      inFlight ??= run(flushOptions.retryRejected ?? false).finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
  };
}

export type OnboardingSync = ReturnType<typeof createOnboardingSync>;

/**
 * Reintenta al abrir la app y cada vez que vuelve la red. Devuelve la funcion que lo detiene.
 * `onResult` avisa a la interfaz para releer el perfil si el servidor cambio algo.
 */
export function watchOnboardingSync(
  sync: Pick<OnboardingSync, "flush">,
  target: Pick<Window, "addEventListener" | "removeEventListener">,
  onResult?: (result: FlushResult) => void,
): () => void {
  const attempt = () => {
    sync
      .flush()
      .then((result) => onResult?.(result))
      .catch(() => {
        // Fallo de almacenamiento: la cola sigue en Dexie y se reintenta en el proximo evento.
      });
  };
  target.addEventListener("online", attempt);
  attempt();
  return () => target.removeEventListener("online", attempt);
}
