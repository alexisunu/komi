import { afterEach, describe, expect, it, vi } from "vitest";
import { uuid } from "../../test/db";
import { ApiError, createApiClient, resolveApiBase } from "./apiClient";

const ID = uuid(7);
const BASE = "https://api.komi.test";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

type FetchMock = ReturnType<typeof vi.fn<typeof fetch>>;

function clientWith(fetchFn: FetchMock, extra: Partial<Parameters<typeof createApiClient>[0]> = {}) {
  return createApiClient({ baseUrl: BASE, fetchFn, getProfileId: () => ID, ...extra });
}

function headersOf(fetchFn: FetchMock, call = 0): Record<string, string> {
  return (fetchFn.mock.calls[call]?.[1]?.headers ?? {}) as Record<string, string>;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("resolveApiBase", () => {
  it("sin valor no hay servidor y no es un error", () => {
    for (const raw of [undefined, "", "   "]) {
      expect(resolveApiBase(raw, false)).toEqual({ base: null, error: null });
    }
  });

  it("acepta https y quita la barra final y el resto de la URL", () => {
    expect(resolveApiBase("https://api.komi.app/", true).base).toBe("https://api.komi.app");
    expect(resolveApiBase("https://api.komi.app/v/", true).base).toBe("https://api.komi.app/v");
    expect(resolveApiBase("  https://api.komi.app?x=1#y ", true).base).toBe("https://api.komi.app");
  });

  it("en produccion exige https salvo en localhost", () => {
    expect(resolveApiBase("http://api.komi.app", true)).toMatchObject({ base: null });
    expect(resolveApiBase("http://api.komi.app", true).error).toContain("https");
    for (const host of ["localhost:8000", "127.0.0.1:8000", "[::1]:8000"]) {
      expect(resolveApiBase(`http://${host}`, true).base).toBe(`http://${host}`);
    }
  });

  it("en desarrollo admite http en la red local", () => {
    expect(resolveApiBase("http://192.168.1.20:8000", false).base).toBe("http://192.168.1.20:8000");
  });

  it("rechaza URL invalidas, otros protocolos y credenciales incrustadas", () => {
    for (const raw of [
      "no es una url",
      "ftp://api.komi.app",
      "javascript:alert(1)",
      "https://u:p@api.komi.app",
      "https://u@api.komi.app",
      "https://:p@api.komi.app",
    ]) {
      const result = resolveApiBase(raw, false);
      expect(result.base, raw).toBeNull();
      expect(result.error, raw).not.toBeNull();
    }
  });
});

describe("peticiones", () => {
  it("manda X-Profile-Id en cada peticion, sea GET, POST o PATCH", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => json({ ok: true }));
    const api = clientWith(fetchFn);
    await api.get("/garden/books/");
    await api.post("/profile/sync/", { body: { a: 1 } });
    await api.patch("/garden/books/x/", { body: { b: 2 } });
    expect(fetchFn).toHaveBeenCalledTimes(3);
    for (let i = 0; i < 3; i += 1) expect(headersOf(fetchFn, i)["X-Profile-Id"]).toBe(ID);
  });

  it("un profileId explicito gana sobre el del dispositivo (onboarding)", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => json({}));
    const other = uuid(9);
    await clientWith(fetchFn).post("/profile/onboarding/", { body: {}, profileId: other });
    expect(headersOf(fetchFn)["X-Profile-Id"]).toBe(other);
  });

  it("sin perfil no manda la cabecera, y un valor que no es UUID tampoco", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => json({}));
    await clientWith(fetchFn, { getProfileId: () => null }).get("/x/");
    await clientWith(fetchFn, { getProfileId: () => "no-es-uuid" }).get("/x/");
    expect(headersOf(fetchFn, 0)["X-Profile-Id"]).toBeUndefined();
    expect(headersOf(fetchFn, 1)["X-Profile-Id"]).toBeUndefined();
  });

  it("une la URL base con /api/v1 y el camino, serializa JSON y no manda cookies", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => json({ ok: true }, 201));
    const result = await clientWith(fetchFn).post<{ ok: boolean }>("/profile/onboarding/", {
      body: { profile_id: ID },
    });
    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(url).toBe("https://api.komi.test/api/v1/profile/onboarding/");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({ profile_id: ID }));
    expect(init?.credentials).toBe("omit");
    expect(headersOf(fetchFn)["Content-Type"]).toBe("application/json");
    expect(headersOf(fetchFn)["Accept"]).toBe("application/json");
    expect(result).toEqual({ status: 201, data: { ok: true } });
  });

  it("un GET no manda cuerpo ni Content-Type", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => json({}));
    await clientWith(fetchFn).get("/stats/weekly/");
    expect(fetchFn.mock.calls[0]?.[1]?.body).toBeNull();
    expect(headersOf(fetchFn)["Content-Type"]).toBeUndefined();
  });

  it("sin URL base ninguna peticion sale del dispositivo", async () => {
    const fetchFn = vi.fn<typeof fetch>();
    const api = createApiClient({ baseUrl: null, fetchFn });
    expect(api.isConfigured).toBe(false);
    await expect(api.get("/x/")).rejects.toMatchObject({ kind: "not_configured", retryable: false });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(clientWith(fetchFn).isConfigured).toBe(true);
  });
});

describe("errores", () => {
  async function failure(fetchFn: FetchMock): Promise<ApiError> {
    try {
      await clientWith(fetchFn).get("/x/");
    } catch (error) {
      return error as ApiError;
    }
    throw new Error("Se esperaba un error");
  }

  it.each([408, 425, 429, 500, 502, 503, 504])("el codigo %s es reintentable", async (status) => {
    const error = await failure(vi.fn<typeof fetch>(async () => json({}, status)));
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ kind: "http", status, retryable: true });
  });

  it.each([400, 401, 404, 409, 415, 422])("el codigo %s es permanente", async (status) => {
    const error = await failure(vi.fn<typeof fetch>(async () => json({}, status)));
    expect(error).toMatchObject({ kind: "http", status, retryable: false });
  });

  it("un fallo de red es reintentable", async () => {
    const error = await failure(
      vi.fn<typeof fetch>(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    expect(error).toMatchObject({ kind: "network", status: null, retryable: true });
  });

  it("una respuesta que no es JSON es reintentable (portal cautivo o proxy)", async () => {
    const error = await failure(vi.fn<typeof fetch>(async () => new Response("<html>", { status: 200 })));
    expect(error).toMatchObject({ kind: "invalid_response", retryable: true });
  });

  it("agota el tiempo y aborta la peticion", async () => {
    vi.useFakeTimers();
    const fetchFn = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );
    const pending = clientWith(fetchFn, { timeoutMs: 50 }).get("/x/");
    const assertion = expect(pending).rejects.toMatchObject({ kind: "timeout", retryable: true });
    await vi.advanceTimersByTimeAsync(60);
    await assertion;
  });

  it("los mensajes de error no contienen el UUID del perfil", async () => {
    for (const fetchFn of [
      vi.fn<typeof fetch>(async () => json({ detail: ID }, 400)),
      vi.fn<typeof fetch>(async () => {
        throw new TypeError(ID);
      }),
      vi.fn<typeof fetch>(async () => new Response(ID, { status: 200 })),
    ]) {
      const error = await failure(fetchFn);
      expect(error.message).not.toContain(ID);
      expect(JSON.stringify(error)).not.toContain(ID);
    }
  });
});
