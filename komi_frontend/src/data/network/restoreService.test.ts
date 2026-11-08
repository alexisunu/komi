import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, fakeClock, uuid } from "../../test/db";
import { createApiClient } from "./apiClient";
import {
  BOOK_PHYSICAL,
  RESTORE_PROFILE_ID,
  restoreBody,
  serverBook,
} from "../../test/restoreFixture";
import type { KomiDatabase } from "../local_db/dexieDatabase";
import { createLocalProfileRepository } from "../local_db/localProfileRepository";
import { createRestoreService, RESTORE_PATH, RESTORE_TIMEOUT_MS } from "./restoreService";

let db: KomiDatabase;
const clock = fakeClock("2026-11-06T12:00:00.000Z");

beforeEach(() => {
  db = createTestDb();
});
afterEach(() => db.close());

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function setup(fetchFn: typeof fetch, over: { wake?: { ensureAwake: () => Promise<boolean> }; baseUrl?: string | null } = {}) {
  const fetchMock = vi.fn<typeof fetch>(fetchFn);
  const api = createApiClient({
    baseUrl: over.baseUrl === undefined ? "https://api.komi.test" : over.baseUrl,
    fetchFn: fetchMock,
    getProfileId: async () => (await createLocalProfileRepository(db, clock, undefined).getProfile())?.profile_id ?? null,
  });
  const service = createRestoreService({ db, api, clock, storage: undefined, ...(over.wake ? { wake: over.wake } : {}) });
  return { service, fetchMock };
}

const headerOf = (call: unknown[]) => ((call[1] as RequestInit).headers as Record<string, string>)["X-Profile-Id"];

describe("recuperar con un codigo", () => {
  it("pide el historial con el codigo tecleado y lo guarda", async () => {
    const { service, fetchMock } = setup(async () => json(200, restoreBody()));
    const outcome = await service.restore(RESTORE_PROFILE_ID);
    expect(outcome.kind).toBe("restored");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://api.komi.test/api/v1${RESTORE_PATH}`);
    expect(init.method).toBe("GET");
    expect(headerOf(fetchMock.mock.calls[0] as unknown[])).toBe(RESTORE_PROFILE_ID);
    expect(await db.books.count()).toBe(2);
    expect((await db.profile.get("local"))?.profile_id).toBe(RESTORE_PROFILE_ID);
  });

  it("acepta el codigo con espacios y en mayusculas (y lo manda en minusculas)", async () => {
    // Con letras hexadecimales: un UUID solo de digitos no distingue mayusculas de minusculas.
    const withLetters = "abcdef01-2345-4678-89ab-cdef01234567";
    const body = restoreBody({
      profile: { ...(restoreBody()["profile"] as object), profile_id: withLetters },
    });
    const { service, fetchMock } = setup(async () => json(200, body));
    const outcome = await service.restore(`  ${withLetters.toUpperCase()}\n`);
    expect(outcome.kind).toBe("restored");
    expect(headerOf(fetchMock.mock.calls[0] as unknown[])).toBe(withLetters);
    expect((await db.profile.get("local"))?.profile_id).toBe(withLetters);
  });

  it("devuelve el resumen de lo que se agrego", async () => {
    const { service } = setup(async () => json(200, restoreBody()));
    expect(await service.restore(RESTORE_PROFILE_ID)).toEqual({
      kind: "restored",
      report: { profileCreated: true, booksAdded: 2, booksAdvanced: 0, sessionsAdded: 2, chatsAdded: 1 },
    });
  });

  it("repetirlo es seguro: la segunda vez no agrega nada", async () => {
    const { service } = setup(async () => json(200, restoreBody()));
    await service.restore(RESTORE_PROFILE_ID);
    expect(await service.restore(RESTORE_PROFILE_ID)).toEqual({
      kind: "restored",
      report: { profileCreated: false, booksAdded: 0, booksAdvanced: 0, sessionsAdded: 0, chatsAdded: 0 },
    });
  });

  it("espera a que el servidor despierte antes de pedir el historial", async () => {
    const order: string[] = [];
    const wake = {
      ensureAwake: vi.fn(async () => {
        order.push("wake");
        return true;
      }),
    };
    const { service } = setup(async () => {
      order.push("get");
      return json(200, restoreBody());
    }, { wake });
    await service.restore(RESTORE_PROFILE_ID);
    expect(order).toEqual(["wake", "get"]);
  });

  it("si el despertar falla, igual lo intenta", async () => {
    const wake = { ensureAwake: vi.fn(async () => Promise.reject(new Error("x"))) };
    const { service } = setup(async () => json(200, restoreBody()), { wake });
    expect((await service.restore(RESTORE_PROFILE_ID)).kind).toBe("restored");
  });

  it("da mas margen de tiempo que una peticion normal y lo usa", async () => {
    expect(RESTORE_TIMEOUT_MS).toBeGreaterThan(10_000);
    const get = vi.fn(async () => ({ status: 200, data: restoreBody() }));
    const service = createRestoreService({
      db,
      api: { isConfigured: true, get } as never,
      clock,
      storage: undefined,
    });
    await service.restore(RESTORE_PROFILE_ID);
    expect(get).toHaveBeenCalledWith(RESTORE_PATH, { profileId: RESTORE_PROFILE_ID, timeoutMs: RESTORE_TIMEOUT_MS });
  });
});

describe("codigo que no sirve (mensaje generico: no se distingue el motivo)", () => {
  it.each(["", "   ", "abc", "no-es-un-uuid", `${RESTORE_PROFILE_ID}x`, RESTORE_PROFILE_ID.slice(1)])(
    "el formato invalido %j no sale a la red",
    async (code) => {
      const { service, fetchMock } = setup(async () => json(200, restoreBody()));
      expect(await service.restore(code)).toEqual({ kind: "not_found" });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("un codigo que el servidor no conoce (401) da lo mismo que un formato invalido", async () => {
    const { service } = setup(async () => json(401, { detail: "Perfil no valido." }));
    expect(await service.restore(uuid(123))).toEqual({ kind: "not_found" });
    expect(await db.profile.count()).toBe(0);
  });
});

describe("este dispositivo ya tiene otro perfil", () => {
  it("se niega antes de salir a la red", async () => {
    await createLocalProfileRepository(db, clock, undefined).createProfile({
      profile_id: uuid(555),
      daily_goal_minutes: 15,
      preferred_moment: "MORNING",
      ai_reflection_style: "DEEP_ANALYSIS",
    });
    const { service, fetchMock } = setup(async () => json(200, restoreBody()));
    expect(await service.restore(RESTORE_PROFILE_ID)).toEqual({ kind: "other_account" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await db.books.count()).toBe(0);
  });

  it("si otro perfil aparece justo mientras se recupera, la mezcla se niega y no escribe nada", async () => {
    await db.profile.add({
      id: "local",
      profile_id: uuid(555),
      daily_goal_minutes: 15,
      preferred_moment: "MORNING",
      ai_reflection_style: "DEEP_ANALYSIS",
      theme_mode: null,
      preconfigure_tsukimi: null,
      onboarding_synced: true,
      created_at: "2026-10-01T00:00:00.000Z",
      updated_at: "2026-10-01T00:00:00.000Z",
    });
    // La primera lectura (antes de salir a la red) ve el dispositivo vacio; la de la mezcla, no.
    vi.spyOn(db.profile, "get").mockResolvedValueOnce(undefined);
    const { service } = setup(async () => json(200, restoreBody()));
    expect(await service.restore(RESTORE_PROFILE_ID)).toEqual({ kind: "other_account" });
    expect(await db.books.count()).toBe(0);
    expect((await db.profile.get("local"))?.profile_id).toBe(uuid(555));
  });

  it("con el MISMO codigo si deja traer lo que falta", async () => {
    await createLocalProfileRepository(db, clock, undefined).createProfile({
      profile_id: RESTORE_PROFILE_ID,
      daily_goal_minutes: 15,
      preferred_moment: "MORNING",
      ai_reflection_style: "DEEP_ANALYSIS",
    });
    const { service } = setup(async () => json(200, restoreBody()));
    const outcome = await service.restore(RESTORE_PROFILE_ID);
    expect(outcome).toMatchObject({ kind: "restored", report: { profileCreated: false, booksAdded: 2 } });
  });
});

describe("fallas: nunca se escribe nada a medias", () => {
  const empty = async () => {
    expect(await db.profile.count()).toBe(0);
    expect(await db.books.count()).toBe(0);
    expect(await db.sessions.count()).toBe(0);
  };

  it("sin red: no disponible", async () => {
    const { service } = setup(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await service.restore(RESTORE_PROFILE_ID)).toEqual({ kind: "unavailable" });
    await empty();
  });

  it.each([429, 500, 502, 503, 504])("el servidor responde %i: no disponible", async (status) => {
    const { service } = setup(async () => json(status, { detail: "x" }));
    expect(await service.restore(RESTORE_PROFILE_ID)).toEqual({ kind: "unavailable" });
    await empty();
  });

  it("sin servidor configurado: no disponible, sin tocar nada", async () => {
    const { service, fetchMock } = setup(async () => json(200, restoreBody()), { baseUrl: null });
    expect(await service.restore(RESTORE_PROFILE_ID)).toEqual({ kind: "unavailable" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("un 400 permanente: fallo", async () => {
    const { service } = setup(async () => json(400, { detail: "x" }));
    expect(await service.restore(RESTORE_PROFILE_ID)).toEqual({ kind: "failed" });
  });

  it("una respuesta que no es JSON (portal cautivo) se puede reintentar", async () => {
    const { service } = setup(async () => new Response("<html></html>", { status: 200 }));
    expect(await service.restore(RESTORE_PROFILE_ID)).toEqual({ kind: "unavailable" });
    await empty();
  });

  it("una respuesta con la forma equivocada: fallo y nada escrito", async () => {
    const { service } = setup(async () => json(200, restoreBody({ books: [serverBook(BOOK_PHYSICAL, { status: "X" })] })));
    expect(await service.restore(RESTORE_PROFILE_ID)).toEqual({ kind: "failed" });
    await empty();
  });

  it("un servidor que responde con OTRO perfil no es de fiar", async () => {
    const other = restoreBody({
      profile: { profile_id: uuid(444), daily_goal_minutes: 15, preferred_moment: "NIGHT", ai_reflection_style: "KEY_SUMMARY" },
    });
    const { service } = setup(async () => json(200, other));
    expect(await service.restore(RESTORE_PROFILE_ID)).toEqual({ kind: "failed" });
    await empty();
  });

  it("sin espacio o sin permiso para guardar: aviso de almacenamiento y nada escrito", async () => {
    const quota = Object.assign(new Error("lleno"), { name: "QuotaExceededError" });
    vi.spyOn(db.books, "add").mockRejectedValue(quota);
    const { service } = setup(async () => json(200, restoreBody()));
    expect(await service.restore(RESTORE_PROFILE_ID)).toEqual({ kind: "storage" });
    await empty();
  });

  it("un error inesperado al guardar: fallo", async () => {
    vi.spyOn(db.books, "add").mockRejectedValue(new Error("raro"));
    const { service } = setup(async () => json(200, restoreBody()));
    expect(await service.restore(RESTORE_PROFILE_ID)).toEqual({ kind: "failed" });
    await empty();
  });

  it("si IndexedDB no se puede leer al empezar: aviso de almacenamiento sin salir a la red", async () => {
    vi.spyOn(db.profile, "get").mockRejectedValue(Object.assign(new Error("x"), { name: "OpenFailedError" }));
    const { service, fetchMock } = setup(async () => json(200, restoreBody()));
    expect(await service.restore(RESTORE_PROFILE_ID)).toEqual({ kind: "storage" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("privacidad", () => {
  it("el codigo no aparece en ningun mensaje de error ni en la consola", async () => {
    const spies = (["log", "warn", "error", "info", "debug"] as const).map((method) => vi.spyOn(console, method));
    const { service } = setup(async () => json(401, { detail: "Perfil no valido." }));
    await service.restore(RESTORE_PROFILE_ID);
    for (const spy of spies) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain(RESTORE_PROFILE_ID);
    }
    vi.restoreAllMocks();
  });
});
