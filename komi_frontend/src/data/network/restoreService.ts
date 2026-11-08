// Recuperar los datos de un perfil desde el servidor (Fase 5.3; SRS 11.4 y 18, punto 8).
//
// El "codigo de recuperacion" es el `profile_id`. Se pide GET /profile/sync/restore/ con ESE codigo
// en X-Profile-Id (no con el del dispositivo) y el resultado se mezcla en Dexie de forma aditiva,
// idempotente y atomica (localRestore). Antes de salir, espera a que el servicio despierte (plan
// gratuito de Render). Respuestas deliberadamente genericas: un codigo con formato invalido y un
// codigo desconocido dan el MISMO resultado (`not_found`), para no decir que UUID existen.
// Nunca se escribe el codigo en logs ni en mensajes.

import { getDatabase, type KomiDatabase } from "../local_db/dexieDatabase";
import { KomiLocalError, RestoreProfileMismatchError } from "../local_db/errors";
import { systemClock, type LocalClock } from "../local_db/localBookRepository";
import { applyRestore, type RestoreReport } from "../local_db/localRestore";
import { createLocalProfileRepository } from "../local_db/localProfileRepository";
import { parseRestorePayload } from "../local_db/restoreFormat";
import { isUuid } from "../local_db/sessionRules";
import { ApiError, getApiClient, type ApiClient } from "./apiClient";

export const RESTORE_PATH = "/profile/sync/restore/";
/** La respuesta trae todo el historial: se le da mas margen que a una peticion normal (10 s). */
export const RESTORE_TIMEOUT_MS = 30_000;

export type RestoreOutcome =
  | { kind: "restored"; report: RestoreReport }
  /** Formato invalido o codigo que el servidor no conoce (no se distinguen). */
  | { kind: "not_found" }
  /** El dispositivo ya tiene otro perfil: no se mezcla ni se reemplaza. */
  | { kind: "other_account" }
  /** Sin red, tiempo agotado, servicio caido o sin servidor configurado: se puede reintentar. */
  | { kind: "unavailable" }
  /** No hay espacio o el navegador no deja guardar datos. */
  | { kind: "storage" }
  /** Respuesta inesperada u otro error: no se escribio nada. */
  | { kind: "failed" };

export interface RestoreServiceOptions {
  db?: KomiDatabase;
  api?: ApiClient;
  clock?: LocalClock;
  /** Espera a que el servidor despierte antes de pedir el historial. */
  wake?: { ensureAwake(maxMs?: number): Promise<boolean> };
  /** Copia del `profile_id` en localStorage (pruebas); por defecto la del navegador. */
  storage?: Pick<Storage, "setItem"> | undefined;
}

export function createRestoreService(options: RestoreServiceOptions = {}) {
  const db = options.db ?? getDatabase();
  const api = options.api ?? getApiClient();
  const clock = options.clock ?? systemClock;
  const profiles = createLocalProfileRepository(db, clock);

  async function restore(rawCode: string): Promise<RestoreOutcome> {
    const code = rawCode.trim().toLowerCase();
    if (!isUuid(code)) return { kind: "not_found" };

    // El perfil del dispositivo se comprueba ANTES de salir a la red.
    try {
      const local = await profiles.getProfile();
      if (local && local.profile_id !== code) return { kind: "other_account" };
    } catch {
      return { kind: "storage" };
    }
    if (!api.isConfigured) return { kind: "unavailable" };

    await options.wake?.ensureAwake().catch(() => false);

    let data: unknown;
    try {
      ({ data } = await api.get<unknown>(RESTORE_PATH, { profileId: code, timeoutMs: RESTORE_TIMEOUT_MS }));
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.status === 401) return { kind: "not_found" };
        if (error.retryable) return { kind: "unavailable" };
      }
      return { kind: "failed" };
    }

    const payload = parseRestorePayload(data);
    // Un servidor que contesta con otro perfil distinto del pedido no es de fiar.
    if (!payload || payload.profile.profile_id !== code) return { kind: "failed" };

    try {
      const report = await applyRestore(db, payload, {
        clock,
        ...("storage" in options ? { storage: options.storage } : {}),
      });
      return { kind: "restored", report };
    } catch (error) {
      if (error instanceof RestoreProfileMismatchError) return { kind: "other_account" };
      if (error instanceof KomiLocalError && (error.code === "storage_unavailable" || error.code === "storage_quota")) {
        return { kind: "storage" };
      }
      return { kind: "failed" };
    }
  }

  return { restore };
}

export type RestoreService = ReturnType<typeof createRestoreService>;
