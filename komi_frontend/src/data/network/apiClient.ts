// Cliente HTTP hacia el backend Django (SRS 13.2 y 18, punto 7). Sin JWT: se identifica con la
// cabecera X-Profile-Id en cada peticion. La URL base sale de VITE_API_URL; no hay valor por
// defecto. El UUID funciona como credencial: no se escribe en mensajes de error ni en logs.

import { getDatabase } from "../local_db/dexieDatabase";
import { createLocalProfileRepository } from "../local_db/localProfileRepository";
import { isUuid } from "../local_db/sessionRules";

export const API_PREFIX = "/api/v1";
export const PROFILE_HEADER = "X-Profile-Id";
export const DEFAULT_TIMEOUT_MS = 10_000;

export interface ApiBaseResult {
  /** URL base sin barra final, o null si no hay servidor configurado. */
  base: string | null;
  /** Descripcion del problema si VITE_API_URL tiene un valor invalido. */
  error: string | null;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Valida VITE_API_URL. Vacia o ausente = sin servidor (el perfil se guarda y el POST queda en
 * cola). En produccion exige https; solo se admite http en localhost (por ejemplo, vite preview).
 */
export function resolveApiBase(raw: string | undefined, production: boolean): ApiBaseResult {
  const text = raw?.trim() ?? "";
  if (text === "") return { base: null, error: null };
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { base: null, error: "VITE_API_URL no es una URL valida." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { base: null, error: "VITE_API_URL debe empezar con https:// o http://." };
  }
  if (url.username !== "" || url.password !== "") {
    return { base: null, error: "VITE_API_URL no debe incluir usuario ni contrasena." };
  }
  if (production && url.protocol !== "https:" && !LOOPBACK_HOSTS.has(url.hostname)) {
    return { base: null, error: "En produccion VITE_API_URL debe usar https://." };
  }
  return { base: url.origin + url.pathname.replace(/\/+$/, ""), error: null };
}

export type ApiErrorKind = "not_configured" | "network" | "timeout" | "http" | "invalid_response";

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | null;
  /** Si vale la pena reintentar mas tarde (sin red, tiempo agotado, 408, 425, 429 y 5xx). */
  readonly retryable: boolean;
  /** `code` estable del cuerpo JSON del error (por ejemplo `chat_closed`), si el servidor lo envio. */
  readonly code: string | null;
  /** Segundos de la cabecera Retry-After, si venia. */
  readonly retryAfterSec: number | null;

  constructor(
    kind: ApiErrorKind,
    message: string,
    status: number | null,
    retryable: boolean,
    extra: { code?: string | null; retryAfterSec?: number | null } = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
    this.retryable = retryable;
    this.code = extra.code ?? null;
    this.retryAfterSec = extra.retryAfterSec ?? null;
  }
}

/** Lee `code` del cuerpo de un error sin consumir la respuesta original ni lanzar. */
async function readErrorCode(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.clone().json();
    const code = (body as { code?: unknown } | null)?.code;
    return typeof code === "string" ? code : null;
  } catch {
    return null;
  }
}

function readRetryAfter(response: Response): number | null {
  const raw = response.headers?.get?.("Retry-After");
  if (raw === null || raw === undefined) return null;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds) : null;
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

export interface ApiResponse<T> {
  status: number;
  data: T;
}

export interface RequestOptions {
  body?: unknown;
  /** Perfil a usar en la cabecera; por defecto el del dispositivo (getProfileId). */
  profileId?: string | null;
  /** Tiempo maximo de esta peticion; por defecto el del cliente (10 s). */
  timeoutMs?: number;
}

export interface ApiClientOptions {
  baseUrl: string | null;
  getProfileId?: () => Promise<string | null> | string | null;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

export function createApiClient(options: ApiClientOptions) {
  const { baseUrl, getProfileId, timeoutMs = DEFAULT_TIMEOUT_MS } = options;

  async function request<T>(
    method: "GET" | "POST" | "PATCH",
    path: string,
    { body, profileId, timeoutMs: requestTimeoutMs }: RequestOptions = {},
  ): Promise<ApiResponse<T>> {
    if (baseUrl === null) {
      throw new ApiError("not_configured", "No hay un servidor configurado (VITE_API_URL).", null, false);
    }
    const fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis);
    const id = profileId ?? (await getProfileId?.()) ?? null;

    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (id !== null && isUuid(id)) headers[PROFILE_HEADER] = id;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs ?? timeoutMs);
    let response: Response;
    try {
      response = await fetchFn(`${baseUrl}${API_PREFIX}${path}`, {
        method,
        headers,
        body: body === undefined ? null : JSON.stringify(body),
        credentials: "omit",
        cache: "no-store",
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted || (error as { name?: string } | null)?.name === "AbortError") {
        throw new ApiError("timeout", "El servidor tardo demasiado en responder.", null, true);
      }
      throw new ApiError("network", "No se pudo conectar con el servidor.", null, true);
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new ApiError(
        "http",
        `El servidor respondio con el codigo ${response.status}.`,
        response.status,
        isRetryableStatus(response.status),
        { code: await readErrorCode(response), retryAfterSec: readRetryAfter(response) },
      );
    }
    let data: T;
    try {
      data = (await response.json()) as T;
    } catch {
      // Puede ser un portal cautivo o un proxy: se reintenta mas tarde.
      throw new ApiError("invalid_response", "El servidor no devolvio JSON valido.", response.status, true);
    }
    return { status: response.status, data };
  }

  /**
   * POST que responde por SSE (chat con Komi). Devuelve la respuesta con el cuerpo SIN leer; el
   * llamador lo consume y decide el tiempo maximo (la `signal` es suya). Los errores previos al
   * stream (404, 409, 429...) llegan como ApiError con su `code`. Si la `signal` aborta, se
   * relanza el AbortError original.
   */
  async function openStream(path: string, { body, signal }: { body: unknown; signal: AbortSignal }): Promise<Response> {
    if (baseUrl === null) {
      throw new ApiError("not_configured", "No hay un servidor configurado (VITE_API_URL).", null, false);
    }
    const fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis);
    const id = (await getProfileId?.()) ?? null;
    const headers: Record<string, string> = { Accept: "text/event-stream", "Content-Type": "application/json" };
    if (id !== null && isUuid(id)) headers[PROFILE_HEADER] = id;

    let response: Response;
    try {
      response = await fetchFn(`${baseUrl}${API_PREFIX}${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        credentials: "omit",
        cache: "no-store",
        signal,
      });
    } catch (error) {
      if (signal.aborted) throw error;
      throw new ApiError("network", "No se pudo conectar con el servidor.", null, true);
    }
    if (!response.ok) {
      throw new ApiError(
        "http",
        `El servidor respondio con el codigo ${response.status}.`,
        response.status,
        isRetryableStatus(response.status),
        { code: await readErrorCode(response), retryAfterSec: readRetryAfter(response) },
      );
    }
    return response;
  }

  return {
    /** Hay una URL base valida; sin ella ninguna peticion sale del dispositivo. */
    isConfigured: baseUrl !== null,
    openStream,
    get: <T>(path: string, options?: RequestOptions) => request<T>("GET", path, options),
    post: <T>(path: string, options?: RequestOptions) => request<T>("POST", path, options),
    patch: <T>(path: string, options?: RequestOptions) => request<T>("PATCH", path, options),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

let shared: ApiClient | null = null;

/** Cliente de la app: VITE_API_URL y el perfil guardado en Dexie. Se crea al primer uso. */
export function getApiClient(): ApiClient {
  if (shared) return shared;
  const { base, error } = resolveApiBase(import.meta.env.VITE_API_URL, import.meta.env.PROD);
  if (error) console.error(error);
  const profiles = createLocalProfileRepository(getDatabase());
  shared = createApiClient({
    baseUrl: base,
    getProfileId: async () => (await profiles.getProfile())?.profile_id ?? null,
  });
  return shared;
}
