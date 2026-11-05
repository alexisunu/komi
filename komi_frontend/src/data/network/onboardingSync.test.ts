import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOnboardingService } from "../../services/onboardingService";
import type { OnboardingAnswers } from "../../services/habitPlan";
import { createTestDb, fakeClock, uuid } from "../../test/db";
import type { KomiDatabase } from "../local_db/dexieDatabase";
import { createLocalMetaRepository, META_KEYS } from "../local_db/localMetaRepository";
import { createLocalProfileRepository } from "../local_db/localProfileRepository";
import { createApiClient } from "./apiClient";
import {
  createOnboardingSync,
  ONBOARDING_PATH,
  parseOnboardingResponse,
  watchOnboardingSync,
} from "./onboardingSync";

const ID = uuid(1);
const answers: OnboardingAnswers = { q1: "B", q2: "B", q3: "A", q4: "A", q5: "B" }; // meta 15
const serverPlan = {
  profile_id: ID,
  daily_goal_minutes: 15,
  preferred_moment: "MORNING",
  ai_reflection_style: "DEEP_ANALYSIS",
  preconfigure_tsukimi: false,
};

let db: KomiDatabase;
let meta: ReturnType<typeof createLocalMetaRepository>;
let profiles: ReturnType<typeof createLocalProfileRepository>;
const log = { warn: vi.fn(), error: vi.fn() };

type FetchMock = ReturnType<typeof vi.fn<typeof fetch>>;

function reply(body: unknown, status = 201): Response {
  return new Response(JSON.stringify(body), { status });
}

beforeEach(async () => {
  db = createTestDb();
  const clock = fakeClock();
  profiles = createLocalProfileRepository(db, clock, undefined);
  meta = createLocalMetaRepository(db);
  log.warn.mockClear();
  log.error.mockClear();
  await createOnboardingService(db, clock, profiles).completeOnboarding({ profile_id: ID, answers });
});
afterEach(() => db.close());

function syncWith(fetchFn: FetchMock, extra: { warnOnMismatch?: boolean; baseUrl?: string | null } = {}) {
  const api = createApiClient({
    baseUrl: extra.baseUrl === undefined ? "https://api.komi.test" : extra.baseUrl,
    fetchFn,
    getProfileId: async () => (await profiles.getProfile())?.profile_id ?? null,
  });
  return createOnboardingSync({
    db,
    api,
    profiles,
    log,
    warnOnMismatch: extra.warnOnMismatch ?? false,
    now: () => new Date("2026-11-05T12:00:00.000Z"),
  });
}

describe("orden: primero Dexie, despues la red", () => {
  it("al enviar, el perfil y la cola ya estan guardados en el dispositivo", async () => {
    let seen: { profile: unknown; pending: unknown } | null = null;
    const fetchFn = vi.fn<typeof fetch>(async () => {
      seen = { profile: await profiles.getProfile(), pending: await meta.get(META_KEYS.onboardingPending) };
      return reply(serverPlan);
    });
    await syncWith(fetchFn).flush();
    expect(seen).not.toBeNull();
    expect((seen as unknown as { profile: { profile_id: string } }).profile.profile_id).toBe(ID);
    expect(JSON.parse(String((seen as unknown as { pending: string }).pending))).toEqual({
      profile_id: ID,
      answers,
    });
  });

  it("manda el cuerpo del contrato y la cabecera X-Profile-Id", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => reply(serverPlan));
    await syncWith(fetchFn).flush();
    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(url).toBe(`https://api.komi.test/api/v1${ONBOARDING_PATH}`);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ profile_id: ID, answers });
    expect((init?.headers as Record<string, string>)["X-Profile-Id"]).toBe(ID);
  });
});

describe("exito", () => {
  it("201: vacia la cola y marca el perfil como sincronizado", async () => {
    const result = await syncWith(vi.fn<typeof fetch>(async () => reply(serverPlan, 201))).flush();
    expect(result.status).toBe("synced");
    expect(await meta.get(META_KEYS.onboardingPending)).toBeUndefined();
    expect((await profiles.getProfile())?.onboarding_synced).toBe(true);
  });

  it("200 (perfil ya existente) tambien confirma", async () => {
    const result = await syncWith(
      vi.fn<typeof fetch>(async () => reply({ ...serverPlan, preconfigure_tsukimi: null }, 200)),
    ).flush();
    expect(result.status).toBe("synced");
    expect((await profiles.getProfile())?.onboarding_synced).toBe(true);
  });

  it("si el servidor devuelve otra meta, prevalece la del servidor (silenciosamente)", async () => {
    const result = await syncWith(
      vi.fn<typeof fetch>(async () =>
        reply({ ...serverPlan, daily_goal_minutes: 30, preferred_moment: "NIGHT", ai_reflection_style: "KEY_SUMMARY" }),
      ),
    ).flush();
    expect(result).toEqual({ status: "synced", profileUpdated: true });
    expect(await profiles.getProfile()).toMatchObject({
      daily_goal_minutes: 30,
      preferred_moment: "NIGHT",
      ai_reflection_style: "KEY_SUMMARY",
      onboarding_synced: true,
    });
    expect(log.warn).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
  });

  it("en desarrollo avisa en consola de la diferencia, sin escribir el UUID", async () => {
    await syncWith(vi.fn<typeof fetch>(async () => reply({ ...serverPlan, daily_goal_minutes: 45 })), {
      warnOnMismatch: true,
    }).flush();
    expect(log.warn).toHaveBeenCalledOnce();
    const message = String(log.warn.mock.calls[0]?.[0]);
    expect(message).toContain("15");
    expect(message).toContain("45");
    expect(message).not.toContain(ID);
  });

  it("si coincide no avisa y solo cambia la marca de sincronizado", async () => {
    const result = await syncWith(vi.fn<typeof fetch>(async () => reply(serverPlan)), {
      warnOnMismatch: true,
    }).flush();
    expect(log.warn).not.toHaveBeenCalled();
    expect(result.profileUpdated).toBe(true); // la marca onboarding_synced pasa a verdadero
    const after = await profiles.getProfile();
    expect(after).toMatchObject({ daily_goal_minutes: 15, preferred_moment: "MORNING" });
  });

  it("el preconfigure_tsukimi del servidor (null en un 200) no pisa el valor local", async () => {
    const before = await profiles.getProfile();
    await syncWith(vi.fn<typeof fetch>(async () => reply({ ...serverPlan, preconfigure_tsukimi: null }, 200))).flush();
    expect((await profiles.getProfile())?.preconfigure_tsukimi).toBe(before?.preconfigure_tsukimi);
  });

  it("si la cola es de otro perfil, no toca el perfil local", async () => {
    await meta.set(META_KEYS.onboardingPending, JSON.stringify({ profile_id: uuid(99), answers }));
    const result = await syncWith(
      vi.fn<typeof fetch>(async () => reply({ ...serverPlan, profile_id: uuid(99), daily_goal_minutes: 45 })),
    ).flush();
    expect(result).toEqual({ status: "synced", profileUpdated: false });
    expect(await profiles.getProfile()).toMatchObject({
      profile_id: ID,
      daily_goal_minutes: 15,
      onboarding_synced: false,
    });
  });

  it("profileUpdated refleja cada diferencia cuando el perfil ya estaba sincronizado", async () => {
    await profiles.updateProfile({ onboarding_synced: true });
    const cases: Array<[string, Partial<typeof serverPlan>, boolean]> = [
      ["igual", {}, false],
      ["otra meta", { daily_goal_minutes: 30 }, true],
      ["otro momento", { preferred_moment: "NIGHT" }, true],
      ["otro estilo", { ai_reflection_style: "KEY_SUMMARY" }, true],
    ];
    for (const [name, change, expected] of cases) {
      await meta.set(META_KEYS.onboardingPending, JSON.stringify({ profile_id: ID, answers }));
      await profiles.updateProfile({
        daily_goal_minutes: 15,
        preferred_moment: "MORNING",
        ai_reflection_style: "DEEP_ANALYSIS",
      });
      const result = await syncWith(vi.fn<typeof fetch>(async () => reply({ ...serverPlan, ...change }))).flush();
      expect(result.profileUpdated, name).toBe(expected);
    }
  });

  it("no hay nada que enviar tras sincronizar", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => reply(serverPlan));
    const sync = syncWith(fetchFn);
    await sync.flush();
    expect((await sync.flush()).status).toBe("nothing");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe("sin red o con errores pasajeros: la cola se conserva", () => {
  const failures: Array<[string, () => Response | Promise<Response>]> = [
    ["503", () => reply({}, 503)],
    ["429", () => reply({}, 429)],
    ["500", () => reply({}, 500)],
    ["respuesta que no es JSON", () => new Response("<html>", { status: 200 })],
    ["respuesta con forma inesperada", () => reply({ hola: 1 }, 201)],
    ["meta fuera de rango", () => reply({ ...serverPlan, daily_goal_minutes: 0 }, 201)],
  ];

  it.each(failures)("%s", async (_name, response) => {
    const result = await syncWith(vi.fn<typeof fetch>(async () => response())).flush();
    expect(result).toEqual({ status: "retry_later", profileUpdated: false });
    expect(await meta.get(META_KEYS.onboardingPending)).not.toBeUndefined();
    expect(await meta.get(META_KEYS.onboardingError)).toBeUndefined();
    expect((await profiles.getProfile())?.onboarding_synced).toBe(false);
    expect(log.error).not.toHaveBeenCalled();
  });

  it("sin conexion (fetch lanza) se reintenta despues y el perfil local sigue intacto", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => {
      throw new TypeError("Failed to fetch");
    });
    const sync = syncWith(fetchFn);
    expect((await sync.flush()).status).toBe("retry_later");
    expect((await sync.flush()).status).toBe("retry_later");
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect((await profiles.getProfile())?.daily_goal_minutes).toBe(15);
  });

  it("al volver la red se envia y se confirma", async () => {
    let online = false;
    const fetchFn = vi.fn<typeof fetch>(async () => {
      if (!online) throw new TypeError("Failed to fetch");
      return reply(serverPlan);
    });
    const sync = syncWith(fetchFn);
    expect((await sync.flush()).status).toBe("retry_later");
    online = true;
    expect((await sync.flush()).status).toBe("synced");
    expect(await meta.get(META_KEYS.onboardingPending)).toBeUndefined();
  });
});

describe("4xx permanente: se conserva onboarding_pending y se registra el error", () => {
  it("400 deja la cola, guarda el error y lo registra en consola sin el UUID", async () => {
    const pendingBefore = await meta.get(META_KEYS.onboardingPending);
    const result = await syncWith(vi.fn<typeof fetch>(async () => reply({ detail: "x" }, 400))).flush();
    expect(result).toEqual({ status: "rejected", profileUpdated: false });
    expect(await meta.get(META_KEYS.onboardingPending)).toBe(pendingBefore);
    const stored = JSON.parse(String(await meta.get(META_KEYS.onboardingError)));
    expect(stored).toEqual({ kind: "http", status: 400, at: "2026-11-05T12:00:00.000Z" });
    expect(log.error).toHaveBeenCalledOnce();
    expect(String(log.error.mock.calls[0]?.[0])).toContain("400");
    expect(JSON.stringify(log.error.mock.calls)).not.toContain(ID);
    expect((await profiles.getProfile())?.onboarding_synced).toBe(false);
  });

  it.each([401, 404, 415, 422])("el codigo %s tambien conserva la cola", async (status) => {
    const result = await syncWith(vi.fn<typeof fetch>(async () => reply({}, status))).flush();
    expect(result.status).toBe("rejected");
    expect(await meta.get(META_KEYS.onboardingPending)).not.toBeUndefined();
  });

  it("no se reintenta solo, pero retryRejected lo fuerza y, si funciona, limpia el error", async () => {
    let status = 400;
    const fetchFn = vi.fn<typeof fetch>(async () => (status === 400 ? reply({}, 400) : reply(serverPlan)));
    const sync = syncWith(fetchFn);
    expect((await sync.flush()).status).toBe("rejected");
    expect((await sync.flush()).status).toBe("skipped_rejected");
    expect(fetchFn).toHaveBeenCalledTimes(1);
    status = 201;
    expect((await sync.flush({ retryRejected: true })).status).toBe("synced");
    expect(await meta.get(META_KEYS.onboardingPending)).toBeUndefined();
    expect(await meta.get(META_KEYS.onboardingError)).toBeUndefined();
  });

  it("una cola corrupta se conserva y se registra como rechazo", async () => {
    await meta.set(META_KEYS.onboardingPending, "{no es json");
    const fetchFn = vi.fn<typeof fetch>();
    const result = await syncWith(fetchFn).flush();
    expect(result.status).toBe("rejected");
    expect(fetchFn).not.toHaveBeenCalled();
    expect(await meta.get(META_KEYS.onboardingPending)).toBe("{no es json");
    expect(JSON.parse(String(await meta.get(META_KEYS.onboardingError))).kind).toBe("corrupt_pending");
  });
});

describe("sin servidor configurado y concurrencia", () => {
  it("sin VITE_API_URL no sale ninguna peticion y la cola se conserva", async () => {
    const fetchFn = vi.fn<typeof fetch>();
    const result = await syncWith(fetchFn, { baseUrl: null }).flush();
    expect(result.status).toBe("not_configured");
    expect(fetchFn).not.toHaveBeenCalled();
    expect(await meta.get(META_KEYS.onboardingPending)).not.toBeUndefined();
  });

  it("llamadas simultaneas comparten una sola peticion", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => reply(serverPlan));
    const sync = syncWith(fetchFn);
    const [a, b, c] = await Promise.all([sync.flush(), sync.flush(), sync.flush()]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect([a.status, b.status, c.status]).toEqual(["synced", "synced", "synced"]);
  });
});

describe("parseOnboardingResponse", () => {
  it("acepta el contrato y normaliza preconfigure_tsukimi", () => {
    expect(parseOnboardingResponse(serverPlan)?.daily_goal_minutes).toBe(15);
    expect(parseOnboardingResponse({ ...serverPlan, daily_goal_minutes: 1 })?.daily_goal_minutes).toBe(1);
    expect(parseOnboardingResponse({ ...serverPlan, daily_goal_minutes: 1440 })?.daily_goal_minutes).toBe(1440);
    expect(parseOnboardingResponse({ ...serverPlan, preconfigure_tsukimi: null })?.preconfigure_tsukimi).toBeNull();
    expect(parseOnboardingResponse({ ...serverPlan, preconfigure_tsukimi: "si" })?.preconfigure_tsukimi).toBeNull();
  });

  it("rechaza formas invalidas", () => {
    for (const bad of [
      null,
      "x",
      {},
      { ...serverPlan, daily_goal_minutes: 15.5 },
      { ...serverPlan, daily_goal_minutes: "15" },
      { ...serverPlan, daily_goal_minutes: 1441 },
      { ...serverPlan, daily_goal_minutes: -3 },
      { ...serverPlan, preferred_moment: "NOON" },
      { ...serverPlan, ai_reflection_style: "OTHER" },
      { ...serverPlan, profile_id: 5 },
    ]) {
      expect(parseOnboardingResponse(bad)).toBeNull();
    }
  });
});

describe("watchOnboardingSync", () => {
  it("intenta al abrir y cada vez que vuelve la red, y se puede detener", async () => {
    const flush = vi.fn(async () => ({ status: "nothing" as const, profileUpdated: false }));
    const listeners = new Map<string, () => void>();
    const target = {
      addEventListener: vi.fn((type: string, fn: () => void) => listeners.set(type, fn)),
      removeEventListener: vi.fn((type: string) => listeners.delete(type)),
    };
    const onResult = vi.fn();
    const stop = watchOnboardingSync({ flush }, target as never, onResult);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(listeners.has("online")).toBe(true);
    listeners.get("online")?.();
    expect(flush).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(onResult).toHaveBeenCalledTimes(2));
    stop();
    expect(target.removeEventListener).toHaveBeenCalledWith("online", expect.any(Function));
    expect(listeners.has("online")).toBe(false);
  });

  it("un fallo de almacenamiento no revienta (la cola sigue en Dexie)", async () => {
    const flush = vi.fn(async () => {
      throw new Error("IndexedDB no disponible");
    });
    const target = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
    expect(() => watchOnboardingSync({ flush }, target as never)).not.toThrow();
    await Promise.resolve();
  });
});
