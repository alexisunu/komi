// Integracion del bloque 6: la hoja post-lectura dentro de la app. Dexie y la app son reales; el
// reloj, Page Visibility, wakeLock, la red y epubjs (que no dibuja en jsdom) son falsos.

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type { KomiDatabase } from "./data/local_db/dexieDatabase";
import { META_KEYS } from "./data/local_db/localMetaRepository";
import { createLocalProfileRepository } from "./data/local_db/localProfileRepository";
import type { LocalBook } from "./data/local_db/types";
import { createApiClient } from "./data/network/apiClient";
import { createReloadGate } from "./pwa/reloadGate";
import { parseActiveSession } from "./services/focusSessionMachine";
import type { WakeLockService } from "./services/wakeLockService";
import { createTestDb, fakeClock, uuid } from "./test/db";
import { createFocusEnv, type FocusEnv } from "./test/focusEnv";
import { createFakeReader } from "./test/readerEnv";
import { render, typeInto } from "./test/render";

let db: KomiDatabase;
let mounted: ReturnType<typeof render> | null = null;
const PROFILE = uuid(77);

beforeEach(() => {
  db = createTestDb();
  document.documentElement.removeAttribute("data-theme");
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }) as never,
  );
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  db.close();
  vi.unstubAllGlobals();
});

function book(over: Partial<LocalBook> = {}): LocalBook {
  return {
    id: uuid(1),
    title: "Libro 1",
    author: "Autora",
    format_type: "PHYSICAL",
    sunflower_variant: "CLASSIC",
    status: "ACTIVE",
    total_pages: 300,
    current_page: 30,
    progress_percentage: 10,
    last_epub_cfi: null,
    created_at: "2026-11-01T00:00:00.000Z",
    completed_at: null,
    updated_at: "2026-11-01T00:00:00.000Z",
    pending_sync: 0,
    ...over,
  };
}

const settle = (ms = 60) => act(async () => new Promise((r) => setTimeout(r, ms)));
async function tap(el: Element | null | undefined) {
  if (!el) throw new Error("Elemento no encontrado");
  await act(async () => {
    (el as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 40));
  });
}
const byText = (root: ParentNode, selector: string, text: string) =>
  [...root.querySelectorAll(selector)].find((el) => el.textContent?.trim().startsWith(text)) ?? null;
const sheet = () => document.querySelector('[role="dialog"]') as HTMLElement | null;
const sheetTitle = () => sheet()?.querySelector("h2")?.textContent;
const sheetButton = (text: string) => byText(sheet() as HTMLElement, "button", text) as HTMLButtonElement | null;
const hasAura = () => sheet()?.querySelector(".sf-aura__ring") != null;

async function storedSession() {
  return parseActiveSession((await db.meta.get(META_KEYS.activeSession))?.value);
}

interface MountOptions {
  env?: FocusEnv;
  fetchFn?: typeof fetch;
  percentageAt?: (...args: never[]) => Promise<number | null>;
}

async function mountApp(books: LocalBook[], options: MountOptions = {}) {
  const env = options.env ?? createFocusEnv();
  const fake = createFakeReader();
  const profiles = createLocalProfileRepository(db, fakeClock(), undefined);
  if (!(await profiles.getProfile())) {
    await profiles.createProfile({
      profile_id: PROFILE,
      daily_goal_minutes: 15,
      preferred_moment: "MORNING",
      ai_reflection_style: "DEEP_ANALYSIS",
    });
    await profiles.updateProfile({ onboarding_synced: true });
  }
  for (const b of books) await db.books.put(b);
  const fetchFn = vi.fn<typeof fetch>(options.fetchFn ?? (async () => new Response("{}", { status: 500 })));
  const api = createApiClient({ baseUrl: "https://api.komi.test", fetchFn, getProfileId: () => PROFILE });
  const reload = vi.fn();
  const gate = createReloadGate(reload);
  const wakeLock = { acquire: vi.fn(async () => {}), release: vi.fn(async () => {}) };
  mounted = render(
    <App
      options={{
        db,
        api,
        focusEnv: { now: env.now, doc: env.doc, win: env.win },
        gate,
        wakeLock: wakeLock as unknown as WakeLockService,
        epubReader: fake.reader,
        ...(options.percentageAt
          ? { epub: { inspect: undefined as never, generateLocations: vi.fn(), percentageAt: options.percentageAt as never } }
          : {}),
      }}
    />,
  );
  await settle();
  return { root: mounted.container, env, fake, gate, reload, fetchFn };
}

const startButton = (root: HTMLElement) => byText(root, "button", "Comenzar lectura") as HTMLButtonElement;
const openButton = (root: HTMLElement) => byText(root, "button", "Comenzar lectura") as HTMLButtonElement;

/** Lee `advanceMs` y termina la sesion; deja la hoja abierta en el Paso 1. */
async function finishPhysical(ctx: Awaited<ReturnType<typeof mountApp>>, advanceMs: number) {
  await tap(startButton(ctx.root));
  ctx.env.advance(advanceMs);
  await tap(byText(ctx.root, "button", "Terminar sesión"));
  await settle();
}

async function enterPage(page: string) {
  typeInto(sheet()?.querySelector("input"), page);
  await tap(sheetButton("Actualizar Girasol"));
  await settle();
}

describe("Paso 1: la pagina se valida contra total_pages", () => {
  it.each([["0"], ["301"], ["999999"]])("la pagina %s da un aviso gentil y no guarda nada", async (page) => {
    const ctx = await mountApp([book()]);
    await finishPhysical(ctx, 600_000);
    await enterPage(page);
    expect(sheetTitle()).toBe("¿Hasta qué página llegaste?");
    expect(sheet()?.querySelector('[role="alert"]')?.textContent).toBe("La página debe estar entre 1 y 300.");
    expect(await db.sessions.count()).toBe(0);
    expect(await storedSession()).not.toBeNull();
    expect(ctx.gate.isBlocked()).toBe(true);
    // Corregir la pagina y volver a enviar guarda normalmente.
    await enterPage("90");
    expect(sheetTitle()).toBe("Sesión terminada");
    expect(await db.sessions.count()).toBe(1);
  });

  it("el campo solo admite digitos y el boton espera a que haya una pagina", async () => {
    const ctx = await mountApp([book({ current_page: 0 })]);
    await finishPhysical(ctx, 600_000);
    const input = sheet()?.querySelector("input") as HTMLInputElement;
    expect(input.value).toBe("");
    expect(sheetButton("Actualizar Girasol")?.disabled).toBe(true);
    typeInto(input, "1a2-3");
    expect(input.value).toBe("123");
    expect(sheetButton("Actualizar Girasol")?.disabled).toBe(false);
  });

  it("tiene como maximo 4 bloques funcionales", async () => {
    const ctx = await mountApp([book()]);
    await finishPhysical(ctx, 600_000);
    expect(sheet()?.querySelectorAll("[data-block]").length).toBeLessThanOrEqual(4);
  });

  it("pulsar dos veces Actualizar Girasol guarda una sola sesion", async () => {
    const ctx = await mountApp([book()]);
    await finishPhysical(ctx, 600_000);
    typeInto(sheet()?.querySelector("input"), "90");
    const button = sheetButton("Actualizar Girasol") as HTMLButtonElement;
    await act(async () => {
      button.click();
      button.click();
      await new Promise((r) => setTimeout(r, 80));
    });
    await settle();
    expect(await db.sessions.count()).toBe(1);
    expect(sheetTitle()).toBe("Sesión terminada");
  });
});

describe("Bono de Vitalidad Solar y florecimiento", () => {
  const big = () => book({ total_pages: 1000, current_page: 100, progress_percentage: 10 });

  it("avance menor de 1 en libro fisico: aura y mensaje", async () => {
    const ctx = await mountApp([big()]);
    await finishPhysical(ctx, 600_000);
    await enterPage("109");
    expect(hasAura()).toBe(true);
    expect(sheet()?.textContent).toContain("Bono de Vitalidad Solar");
    expect((await db.sessions.toArray())[0]?.granted_solar_bonus).toBe(true);
  });

  it("avance de 1 punto o mas: sin aura ni mensaje", async () => {
    const ctx = await mountApp([big()]);
    await finishPhysical(ctx, 600_000);
    await enterPage("110");
    expect(hasAura()).toBe(false);
    expect(sheet()?.textContent).not.toContain("Bono de Vitalidad Solar");
  });

  it("llegar a la ultima pagina florece: titulo, aura, estado y libro fuera de las lecturas", async () => {
    const ctx = await mountApp([book()]);
    await finishPhysical(ctx, 600_000);
    await enterPage("300");
    expect(sheetTitle()).toBe("Tu girasol floreció");
    expect(sheet()?.textContent).toContain("Terminaste el libro y tu girasol floreció.");
    expect(hasAura()).toBe(true);
    expect(await db.books.get(uuid(1))).toMatchObject({ status: "BLOOMED", progress_percentage: 100 });
    await tap(sheetButton("Por hoy no, volver al jardín"));
    expect(startButton(ctx.root).disabled).toBe(true);
  });

  it("una pagina normal no florece ni lleva aura", async () => {
    const ctx = await mountApp([book()]);
    await finishPhysical(ctx, 600_000);
    await enterPage("299");
    expect(sheetTitle()).toBe("Sesión terminada");
    expect(hasAura()).toBe(false);
  });
});

describe("Terminé el libro (menos de 5 minutos)", () => {
  async function openDialog() {
    const ctx = await mountApp([book()]);
    await tap(startButton(ctx.root));
    ctx.env.advance(200_000);
    await tap(byText(ctx.root, "button", "Terminar sesión"));
    return ctx;
  }

  it("el dialogo ofrece Terminé el libro y abre el Paso 1 avisando que hace falta la ultima pagina", async () => {
    await openDialog();
    expect(sheetTitle()).toBe("¿Terminar sin guardar?");
    await tap(sheetButton("Terminé el libro"));
    await settle();
    expect(sheetTitle()).toBe("¿Hasta qué página llegaste?");
    expect(sheet()?.textContent).toContain("última página (300)");
  });

  it("con la ultima pagina vale: se guarda como COMPLETED y florece", async () => {
    const ctx = await openDialog();
    await tap(sheetButton("Terminé el libro"));
    await settle();
    await enterPage("300");
    expect(sheetTitle()).toBe("Tu girasol floreció");
    expect((await db.sessions.toArray())[0]).toMatchObject({ session_status: "COMPLETED", actual_duration_sec: 200 });
    expect(ctx.gate.isBlocked()).toBe(false);
  });

  it("con otra pagina se descarta con un aviso, sin guardar y sin atrapar al lector", async () => {
    const ctx = await openDialog();
    await tap(sheetButton("Terminé el libro"));
    await settle();
    await enterPage("299");
    expect(sheetTitle()).toBe("Sesión sin guardar");
    expect(sheet()?.textContent).toContain("no se guardó");
    expect(await db.sessions.count()).toBe(0);
    expect(await db.books.get(uuid(1))).toMatchObject({ progress_percentage: 10 });
    await tap(sheetButton("Volver al jardín"));
    expect(sheet()).toBeNull();
    expect(ctx.root.querySelector(".dashboard")).not.toBeNull();
    expect(await storedSession()).toBeNull();
    expect(ctx.gate.isBlocked()).toBe(false);
  });

  it("Descartar sigue sin guardar nada", async () => {
    const ctx = await openDialog();
    await tap(sheetButton("Descartar"));
    expect(sheet()).toBeNull();
    expect(await db.sessions.count()).toBe(0);
    expect(await storedSession()).toBeNull();
    expect(ctx.gate.isBlocked()).toBe(false);
  });
});

describe("Paso 2: invitacion opcional a la charla", () => {
  it("Si, conversar con Komi espera al servidor (aqui responde 500, asi que sigue deshabilitado); Por hoy no vuelve al Dashboard", async () => {
    const ctx = await mountApp([book()]);
    await finishPhysical(ctx, 600_000);
    await enterPage("90");
    await settle(100);
    expect(sheet()?.textContent).toContain("¿Quieres charlar un poco sobre lo que acabas de leer?");
    expect(sheetButton("Sí, conversar con Komi")?.disabled).toBe(true);
    expect(sheet()?.textContent).toContain("No pudimos sincronizar tu sesión ahora");
    expect(sheet()?.textContent).not.toContain("Próximamente");
    await tap(sheetButton("Por hoy no, volver al jardín"));
    expect(sheet()).toBeNull();
    expect(ctx.root.querySelector(".dashboard")).not.toBeNull();
  });

  it("los registros ya no existen en el Paso 2: recargar la app no repite la hoja", async () => {
    const ctx = await mountApp([book()]);
    await finishPhysical(ctx, 600_000);
    await enterPage("90");
    mounted?.unmount();
    const again = await mountApp([], { env: ctx.env });
    await settle();
    expect(sheet()).toBeNull();
    expect(again.root.querySelector(".dashboard")).not.toBeNull();
    expect(await db.sessions.count()).toBe(1);
  });
});

describe("la sesion no se pierde", () => {
  it("recarga del Service Worker durante la hoja: se aplaza hasta terminar de guardar", async () => {
    const ctx = await mountApp([book()]);
    await finishPhysical(ctx, 600_000);
    ctx.gate.request();
    expect(ctx.reload).not.toHaveBeenCalled();
    await enterPage("90");
    // El guardado termino y el bloqueo se solto: la recarga pendiente ocurre una sola vez.
    expect(ctx.reload).toHaveBeenCalledTimes(1);
    expect(await db.sessions.count()).toBe(1);
  });

  it("fallo de Dexie: avisa, conserva el registro y la recarga bloqueada, y reintentar guarda", async () => {
    const ctx = await mountApp([book()]);
    await finishPhysical(ctx, 600_000);
    const add = vi.spyOn(db.sessions, "add").mockRejectedValueOnce(new Error("sin espacio"));
    await enterPage("90");
    expect(sheetTitle()).toBe("No se pudo guardar");
    expect(sheet()?.querySelector('[role="alert"]')?.textContent).toContain("Tu sesión sigue a salvo");
    expect(await db.sessions.count()).toBe(0);
    expect(await db.books.get(uuid(1))).toMatchObject({ current_page: 30 });
    expect((await storedSession())?.finalSec).toBe(600);
    expect(ctx.gate.isBlocked()).toBe(true);
    expect(sheet()?.querySelector('[aria-label="Cerrar"]')?.hasAttribute("disabled")).toBe(true);

    await tap(sheetButton("Reintentar"));
    await settle();
    add.mockRestore();
    expect(sheetTitle()).toBe("Sesión terminada");
    expect(await db.sessions.count()).toBe(1);
    expect(await storedSession()).toBeNull();
    expect(ctx.gate.isBlocked()).toBe(false);
  });

  it("fallo de red tras guardar: la sesion queda guardada y pendiente, y el lector sigue su camino", async () => {
    const ctx = await mountApp([book()], {
      fetchFn: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    await finishPhysical(ctx, 600_000);
    const before = ctx.fetchFn.mock.calls.length;
    await enterPage("90");
    await settle(120);
    expect(sheetTitle()).toBe("Sesión terminada");
    expect(ctx.fetchFn.mock.calls.length).toBeGreaterThan(before);
    expect(String(ctx.fetchFn.mock.calls.at(-1)?.[0])).toContain("/profile/sync/");
    expect((await db.sessions.toArray())[0]).toMatchObject({ pending_sync: 1, sync_rejection: null });
    expect(await db.books.get(uuid(1))).toMatchObject({ pending_sync: 1, current_page: 90 });
    expect(await storedSession()).toBeNull();
    expect(ctx.gate.isBlocked()).toBe(false);
    await tap(sheetButton("Por hoy no, volver al jardín"));
    expect(ctx.root.querySelector(".dashboard")).not.toBeNull();
  });

  it("al guardar se intenta subir de inmediato (escritura inmediata de SRS 11.4)", async () => {
    const ctx = await mountApp([book()]);
    await finishPhysical(ctx, 600_000);
    const before = ctx.fetchFn.mock.calls.length;
    await enterPage("90");
    await settle(120);
    expect(ctx.fetchFn.mock.calls.length).toBeGreaterThan(before);
  });

  it("el guardado no espera a la red: la hoja avanza aunque el servidor no responda", async () => {
    const ctx = await mountApp([book()], { fetchFn: () => new Promise<Response>(() => {}) });
    await finishPhysical(ctx, 600_000);
    await enterPage("90");
    expect(sheetTitle()).toBe("Sesión terminada");
  });
});

describe("EPUB en la hoja", () => {
  const epub = () => book({ format_type: "EPUB", total_pages: null, current_page: 0, progress_percentage: 12 });

  async function putFile(locations: string | null) {
    await db.epub_files.put({
      book_id: uuid(1),
      data: new Uint8Array([1, 2, 3, 4]).buffer,
      size_bytes: 4,
      locations,
      created_at: "2026-11-01T00:00:00.000Z",
    });
  }

  it("si la sesion termino sin porcentaje, guarda el valor exacto calculado con percentageAt", async () => {
    const percentageAt = vi.fn(async () => 57.89);
    await db.books.put(epub());
    await putFile('["a"]');
    const ctx = await mountApp([], { percentageAt: percentageAt as never });
    await tap(openButton(ctx.root));
    await settle();
    await act(async () => ctx.fake.see({ cfi: "cfi-x", percentage: null, text: "Texto de la sesion de hoy." }));
    await settle();
    ctx.env.advance(900_000);
    await settle(320);
    await settle(200);
    expect(percentageAt).toHaveBeenCalledWith(expect.anything(), "cfi-x", '["a"]', expect.any(Function));
    expect(sheetTitle()).toBe("Sesión terminada");
    expect(await db.books.get(uuid(1))).toMatchObject({ progress_percentage: 57.89, last_epub_cfi: "cfi-x" });
    expect(sheet()?.textContent).not.toContain("Bono de Vitalidad Solar");
  });

  it("un EPUB nunca recibe el Bono Solar, aunque avance menos de 1", async () => {
    await db.books.put(epub());
    await putFile('["a"]');
    const ctx = await mountApp([]);
    await tap(openButton(ctx.root));
    await settle();
    await act(async () => ctx.fake.see({ cfi: "cfi-x", percentage: 12.5, text: "Texto de la sesion de hoy." }));
    await settle();
    ctx.env.advance(900_000);
    await settle(320);
    await settle(200);
    expect(sheetTitle()).toBe("Sesión terminada");
    expect(hasAura()).toBe(false);
    expect((await db.sessions.toArray())[0]?.granted_solar_bonus).toBe(false);
  });

  it("recargar con el EPUB ya terminado: la hoja reaparece y guarda con el avance del registro", async () => {
    await db.books.put(epub());
    await putFile('["a"]');
    const ctx = await mountApp([]);
    await tap(openButton(ctx.root));
    await settle();
    await act(async () => ctx.fake.see({ cfi: "cfi-x", percentage: 40, text: "Texto de la sesion de hoy." }));
    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
    });
    await settle();
    // El tiempo termina y la app se cierra antes de guardar: finalSec queda en el registro.
    ctx.env.advance(900_000);
    await act(async () => {
      await ctx.env.service.tick();
    });
    mounted?.unmount();
    const stored = await storedSession();
    expect(stored).not.toBeNull();
    // Sin finalSec en Dexie (el reloj de la prueba no lo escribio): se siembra como lo dejaria la app.
    await db.meta.put({ key: META_KEYS.activeSession, value: JSON.stringify({ ...stored, finalSec: 900 }) });
    const again = await mountApp([], { env: ctx.env });
    await settle(200);
    expect(sheetTitle()).toBe("Sesión terminada");
    expect(await db.books.get(uuid(1))).toMatchObject({ progress_percentage: 40 });
    expect(again.gate.isBlocked()).toBe(false);
  });
});
