import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type { KomiDatabase } from "./data/local_db/dexieDatabase";
import { createLocalBookRepository } from "./data/local_db/localBookRepository";
import { createLocalMetaRepository, META_KEYS } from "./data/local_db/localMetaRepository";
import { createLocalProfileRepository } from "./data/local_db/localProfileRepository";
import { createApiClient } from "./data/network/apiClient";
import { createTestDb, fakeClock, uuid } from "./test/db";
import { render } from "./test/render";

let db: KomiDatabase;
let mounted: ReturnType<typeof render> | null = null;
const BASE = "https://api.komi.test";
const ID = uuid(77);

beforeEach(() => {
  db = createTestDb();
  document.documentElement.removeAttribute("data-theme");
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }) as never,
  );
  vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(ID as `${string}-${string}-${string}-${string}-${string}`);
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  db.close();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const serverPlan = (over: Record<string, unknown> = {}) => ({
  profile_id: ID,
  daily_goal_minutes: 15,
  preferred_moment: "MORNING",
  ai_reflection_style: "DEEP_ANALYSIS",
  preconfigure_tsukimi: false,
  ...over,
});

type FetchMock = ReturnType<typeof vi.fn<typeof fetch>>;

function mountApp(fetchFn: FetchMock) {
  const api = createApiClient({ baseUrl: BASE, fetchFn, getProfileId: () => ID });
  mounted = render(<App options={{ db, api }} />);
  return mounted.container;
}

async function waitFor(condition: () => boolean | Promise<boolean>, ms = 2000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await condition()) return;
    await act(async () => new Promise((r) => setTimeout(r, 20)));
  }
  throw new Error("Se agoto la espera");
}

const settle = () => act(async () => new Promise((r) => setTimeout(r, 40)));
async function tap(el: Element | null | undefined) {
  if (!el) throw new Error("Elemento no encontrado");
  await act(async () => {
    (el as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 40));
  });
}
const btn = (root: HTMLElement, text: string) =>
  [...root.querySelectorAll("button")].find((b) => b.textContent?.trim() === text) ?? null;
const radio = (root: HTMLElement, v: string) => root.querySelector(`input[type="radio"][value="${v}"]`);
const navItem = (root: HTMLElement, label: string) =>
  [...root.querySelectorAll(".bottom-nav__item")].find((b) => b.textContent === label);

async function onboard(root: HTMLElement, values: string[]) {
  await tap(btn(root, "Comenzar"));
  for (const v of values) {
    await tap(radio(root, v));
    await tap(btn(root, "Continuar") ?? btn(root, "Generar Plan de Hábito"));
  }
}

async function seedProfile(goal = 30) {
  const profiles = createLocalProfileRepository(db, fakeClock(), undefined);
  await profiles.createProfile({
    profile_id: ID,
    daily_goal_minutes: goal,
    preferred_moment: "MORNING",
    ai_reflection_style: "DEEP_ANALYSIS",
  });
  await profiles.updateProfile({ onboarding_synced: true });
  return profiles;
}

const okFetch = () => vi.fn<typeof fetch>(async () => reply({}));
const ANSWERS = ["B", "B", "A", "A", "B"];

describe("arranque", () => {
  it("muestra 'Cargando' y luego el onboarding si no hay perfil", async () => {
    const root = mountApp(vi.fn<typeof fetch>());
    expect(root.textContent).toContain("Cargando");
    await settle();
    expect(root.textContent).toContain("Bienvenido a Komi");
    expect(root.querySelector(".app-notice")).toBeNull();
  });

  it("con perfil va directo al Dashboard con la meta, la racha y el libro", async () => {
    await seedProfile(30);
    await createLocalMetaRepository(db).set(META_KEYS.streakCurrent, 4);
    await createLocalBookRepository(db, fakeClock()).createBook({
      title: "Walden",
      author: "Thoreau",
      format_type: "PHYSICAL",
      total_pages: 200,
    } as never);
    const root = mountApp(okFetch());
    await settle();
    expect(root.textContent).toContain("4 días seguidos");
    expect(root.querySelector("output")?.textContent).toBe("30:00");
    expect(root.querySelector("h1")?.textContent).toBe("Walden");
  });

  it("si IndexedDB falla entra al onboarding con un aviso", async () => {
    vi.spyOn(db.profile, "get").mockRejectedValue(new DOMException("blocked", "SecurityError"));
    const root = mountApp(vi.fn<typeof fetch>());
    await settle();
    expect(root.querySelector(".app-notice")?.textContent).toContain("no permite guardar datos");
    expect(root.textContent).toContain("Bienvenido a Komi");
  });

  it("si fallan libros o racha, el Dashboard se muestra vacio", async () => {
    await seedProfile();
    vi.spyOn(db.books, "where").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    const root = mountApp(okFetch());
    await settle();
    expect(root.querySelector("h1")?.textContent).toBe("Tu primera semilla te espera");
  });
});

describe("flujo completo", () => {
  it("onboarding, POST al servidor, Dashboard con tres accesos", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => reply(serverPlan(), 201));
    const root = mountApp(fetchFn);
    await settle();
    await onboard(root, ANSWERS);
    expect(root.textContent).toContain("Tu plan Zen está listo");
    await tap(btn(root, "Ir al Dashboard"));

    expect(root.querySelector("h1")?.textContent).toBe("Tu primera semilla te espera");
    const labels = [...root.querySelectorAll(".bottom-nav__label")].map((l) => l.textContent);
    expect(labels).toEqual(["Lectura", "Mi Jardín", "Estadísticas"]);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(url).toBe(`${BASE}/api/v1/profile/onboarding/`);
    expect((init?.headers as Record<string, string>)["X-Profile-Id"]).toBe(ID);
    expect(JSON.parse(String(init?.body))).toEqual({
      profile_id: ID,
      answers: { q1: "B", q2: "B", q3: "A", q4: "A", q5: "B" },
    });
    expect(await createLocalMetaRepository(db).get(META_KEYS.onboardingPending)).toBeUndefined();
    expect((await createLocalProfileRepository(db).getProfile())?.onboarding_synced).toBe(true);
  });

  it("el servidor manda: si responde otra meta, el Dashboard la usa", async () => {
    const root = mountApp(vi.fn<typeof fetch>(async () => reply(serverPlan({ daily_goal_minutes: 45 }), 201)));
    await settle();
    await onboard(root, ANSWERS); // local: 15
    await tap(btn(root, "Ir al Dashboard"));
    expect(root.querySelector("output")?.textContent).toBe("45:00");
    expect((await createLocalProfileRepository(db).getProfile())?.daily_goal_minutes).toBe(45);
  });

  it("sin red: el plan se guarda, el Dashboard abre y la cola se envia al volver la conexion", async () => {
    let online = false;
    const fetchFn = vi.fn<typeof fetch>(async () => {
      if (!online) throw new TypeError("Failed to fetch");
      return reply(serverPlan(), 201);
    });
    const root = mountApp(fetchFn);
    await settle();
    await onboard(root, ANSWERS);
    await tap(btn(root, "Ir al Dashboard"));
    expect(root.querySelector("output")?.textContent).toBe("15:00");
    expect(await createLocalMetaRepository(db).get(META_KEYS.onboardingPending)).toBeDefined();
    expect((await createLocalProfileRepository(db).getProfile())?.daily_goal_minutes).toBe(15);

    online = true;
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await new Promise((r) => setTimeout(r, 60));
    });
    expect(await createLocalMetaRepository(db).get(META_KEYS.onboardingPending)).toBeUndefined();
    expect((await createLocalProfileRepository(db).getProfile())?.onboarding_synced).toBe(true);
  });

  it("un 4xx permanente conserva la cola y no rompe el Dashboard", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const root = mountApp(vi.fn<typeof fetch>(async () => reply({ detail: "x" }, 400)));
    await settle();
    await onboard(root, ANSWERS);
    await tap(btn(root, "Ir al Dashboard"));
    expect(root.querySelector("h1")?.textContent).toBe("Tu primera semilla te espera");
    expect(await createLocalMetaRepository(db).get(META_KEYS.onboardingPending)).toBeDefined();
    expect(await createLocalMetaRepository(db).get(META_KEYS.onboardingError)).toBeDefined();
    expect(error).toHaveBeenCalled();
  });

  it("al reabrir con la cola pendiente se reintenta", async () => {
    const profiles = await seedProfile();
    await profiles.updateProfile({ onboarding_synced: false });
    await createLocalMetaRepository(db).set(
      META_KEYS.onboardingPending,
      JSON.stringify({ profile_id: ID, answers: { q1: "B", q2: "C", q3: "A", q4: "A", q5: "B" } }),
    );
    const fetchFn = vi.fn<typeof fetch>(async () => reply(serverPlan({ daily_goal_minutes: 30 }), 200));
    mountApp(fetchFn);
    await waitFor(async () => (await createLocalMetaRepository(db).get(META_KEYS.onboardingPending)) === undefined);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(await createLocalMetaRepository(db).get(META_KEYS.onboardingPending)).toBeUndefined();
  });
});

describe("datos secundarios y sincronizacion al abrir", () => {
  it("al reabrir, si el servidor cambia la meta, el Dashboard la muestra", async () => {
    const profiles = await seedProfile(15);
    await profiles.updateProfile({ onboarding_synced: false });
    await createLocalMetaRepository(db).set(
      META_KEYS.onboardingPending,
      JSON.stringify({ profile_id: ID, answers: { q1: "B", q2: "B", q3: "A", q4: "A", q5: "B" } }),
    );
    const root = mountApp(vi.fn<typeof fetch>(async () => reply(serverPlan({ daily_goal_minutes: 45 }), 200)));
    await waitFor(() => root.querySelector("output")?.textContent === "45:00");
  });

  it("un libro en barbecho aparece en el lienzo", async () => {
    await seedProfile();
    const books = createLocalBookRepository(db, fakeClock());
    const book = await books.createBook({ title: "Pausa", author: "A", format_type: "PHYSICAL", total_pages: 100 } as never);
    await db.books.update(book.id, { status: "FALLOW", progress_percentage: 40 });
    const root = mountApp(okFetch());
    await settle();
    expect(root.querySelector("h1")?.textContent).toBe("Pausa");
    expect(root.querySelector('[role="img"]')?.getAttribute("aria-label")).toContain("barbecho");
  });

  it("si la racha no se puede leer, el Dashboard muestra 'Sin racha aún'", async () => {
    await seedProfile();
    const real = db.meta.get.bind(db.meta);
    vi.spyOn(db.meta, "get").mockImplementation(((key: string) => {
      if (key === META_KEYS.streakCurrent) return Promise.reject(new DOMException("x", "SecurityError"));
      return real(key);
    }) as never);
    const root = mountApp(okFetch());
    await settle();
    expect(root.textContent).toContain("Sin racha aún");
    expect(root.querySelector("output")).not.toBeNull();
  });
});

describe("tema", () => {
  it("sin red igual se aplica Tsukimi: el perfil local trae la regla de fatiga", async () => {
    const root = mountApp(vi.fn<typeof fetch>(async () => {
      throw new TypeError("Failed to fetch");
    }));
    await settle();
    await onboard(root, ["B", "C", "C", "B", "B"]);
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("la regla de fatiga nocturna activa Tsukimi en la confirmacion", async () => {
    const root = mountApp(vi.fn<typeof fetch>(async () => reply(serverPlan({ preconfigure_tsukimi: true }), 201)));
    await settle();
    await onboard(root, ["B", "C", "C", "B", "B"]);
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("el interruptor de Ajustes guarda theme_mode en Dexie y se respeta al reabrir", async () => {
    await seedProfile();
    const first = mountApp(okFetch());
    await settle();
    await tap(first.querySelector('[aria-label="Ajustes"]'));
    await tap(first.querySelector('[role="switch"]'));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect((await createLocalProfileRepository(db).getProfile())?.theme_mode).toBe("dark");
    mounted?.unmount();
    document.documentElement.removeAttribute("data-theme");
    mountApp(okFetch());
    await settle();
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });
});

describe("navegacion y bloques", () => {
  it("cada destino muestra su pantalla y ninguna pasa de 4 bloques", async () => {
    await seedProfile();
    const root = mountApp(okFetch());
    await settle();
    const blocks = () => root.querySelectorAll("[data-block]").length;

    expect(blocks()).toBe(4);
    await tap(navItem(root, "Mi Jardín"));
    expect(root.querySelector("h1")?.textContent).toBe("Mi Jardín");
    expect(blocks()).toBeLessThanOrEqual(4);
    await tap(navItem(root, "Estadísticas"));
    expect(root.querySelector("h1")?.textContent).toBe("Estadísticas");
    expect(blocks()).toBeLessThanOrEqual(4);
    await tap(navItem(root, "Lectura"));
    expect(root.querySelector("output")).not.toBeNull();
    expect(navItem(root, "Lectura")?.getAttribute("aria-current")).toBe("page");
  });

  it("los textos de las pantallas vacias llevan tildes y ningun emoji", async () => {
    await seedProfile();
    const root = mountApp(okFetch());
    await settle();
    const texts: string[] = [];
    for (const label of ["Mi Jardín", "Estadísticas", "Lectura"]) {
      await tap(navItem(root, label));
      texts.push(root.textContent ?? "");
    }
    for (const t of texts) expect(t).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(texts.join(" ")).toContain("Aquí crecerán tus libros");
    expect(texts.join(" ")).toContain("aparecerán aquí");
  });
});
