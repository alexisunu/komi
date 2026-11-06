// Integracion del bloque 7: de la hoja post-lectura a la charla con Komi, dentro de la app. Dexie y la
// app son reales; el reloj, Page Visibility, wakeLock, epubjs y el servidor (sync y SSE) son falsos.

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type { KomiDatabase } from "./data/local_db/dexieDatabase";
import { META_KEYS } from "./data/local_db/localMetaRepository";
import { createLocalProfileRepository } from "./data/local_db/localProfileRepository";
import type { LocalBook } from "./data/local_db/types";
import { createApiClient } from "./data/network/apiClient";
import { createReloadGate } from "./pwa/reloadGate";
import type { WakeLockService } from "./services/wakeLockService";
import { createTestDb, fakeClock, uuid } from "./test/db";
import { createFakeServer, deferred, type FakeServer } from "./test/fakeCompanionServer";
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
const sheetButton = (text: string) => byText(sheet() as HTMLElement, "button", text) as HTMLButtonElement | null;


interface MountOptions {
  env?: FocusEnv;
  fetchFn?: typeof fetch;
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
      }}
    />,
  );
  await settle();
  return { root: mounted.container, env, fake, gate, reload, fetchFn };
}

const startButton = (root: HTMLElement) => byText(root, "button", "Comenzar Lectura") as HTMLButtonElement;

/** Lee `minutes` y termina antes de tiempo; deja la hoja abierta en el Paso 1. */
async function finishPhysical(ctx: Awaited<ReturnType<typeof mountApp>>, advanceMs: number) {
  await tap(startButton(ctx.root));
  ctx.env.advance(advanceMs);
  await tap(byText(ctx.root, "button", "Terminé antes de tiempo"));
  await settle();
}

async function enterPage(page: string) {
  typeInto(sheet()?.querySelector("input"), page);
  await tap(sheetButton("Actualizar Girasol"));
  await settle();
}

let server: FakeServer;
beforeEach(() => {
  server = createFakeServer({ profileId: PROFILE });
});

const chatField = () => document.querySelector("textarea") as HTMLTextAreaElement;
const screenText = () => document.body.textContent ?? "";
const zen = () => document.querySelector('[data-testid="zen-cycle"]')?.textContent;
async function typeMessage(value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(chatField(), value);
    chatField().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const chatButton = (text: string) => byText(document.body, "button", text) as HTMLButtonElement | null;

/** Lee 10 minutos de 15, llega a la pagina 90 y deja la hoja guardada en el Paso 2. */
async function savedSheet() {
  const ctx = await mountApp([book()], { fetchFn: server.fetchFn });
  await finishPhysical(ctx, 600_000);
  await enterPage("90");
  await settle(100);
  return ctx;
}

describe("de la hoja a la charla", () => {
  it("Si, conversar con Komi esta habilitado y abre la charla de esa sesion", async () => {
    const ctx = await savedSheet();
    const open = sheetButton("Sí, conversar con Komi");
    expect(open?.disabled).toBe(false);
    expect(sheet()?.textContent).not.toContain("Próximamente");
    await tap(open);
    await settle(100);
    expect(sheet()).toBeNull();
    expect(zen()).toBe("Ciclo Zen: Turno 1 de 5");
    const session = (await db.sessions.toArray())[0];
    expect(server.startCalls()[0]?.body).toEqual({ session_id: session?.id });
    // La sesion ya habia subido (flush) antes de abrir el chat.
    expect(session?.pending_sync).toBe(0);
    expect(ctx.root.querySelector(".dashboard")).toBeNull();
    expect(ctx.root.querySelector('[data-block="nav"]')).toBeNull();
  });

  it("charla completa: 4 envios, semilla en reflections y vuelta al Dashboard", async () => {
    const ctx = await savedSheet();
    await tap(sheetButton("Sí, conversar con Komi"));
    await settle(100);
    for (let i = 1; i <= 3; i += 1) {
      server.reply({ kind: "ok", chunks: [`Respuesta ${i}`] });
      await typeMessage(`mensaje ${i}`);
      await tap(chatButton("Enviar"));
      await settle(100);
    }
    server.reply({ kind: "ok", chunks: ["Cierre"], seed: "Leer es sembrar." });
    await typeMessage("mensaje 4");
    await tap(chatButton("Enviar"));
    await settle(100);
    expect(zen()).toBe("Ciclo Zen: Turno 5 de 5");
    expect(screenText()).toContain("Leer es sembrar.");
    const row = await db.reflections.toCollection().first();
    expect(row).toMatchObject({ turn_count: 5, is_closed: true, key_takeaway: "Leer es sembrar.", book_id: uuid(1) });
    await tap(chatButton("Guardar reflexión y volver al jardín"));
    await settle();
    expect(document.querySelector("textarea")).toBeNull();
    expect(ctx.root.querySelector(".dashboard")).not.toBeNull();
    expect(ctx.root.querySelector('[data-block="nav"]')).not.toBeNull();
    expect(await db.reflections.count()).toBe(1);
  });

  it("el servidor no responde (503): la hoja no ofrece la charla, lo dice sin culpar a internet y Reintentar la habilita", async () => {
    server.state.syncDown = true;
    await savedSheet();
    expect(sheetButton("Sí, conversar con Komi")?.disabled).toBe(true);
    expect(sheet()?.textContent).toContain("No pudimos sincronizar tu sesión ahora");
    expect(sheet()?.textContent).not.toContain("No hay conexión");
    expect(server.startCalls()).toHaveLength(0);
    expect((await db.sessions.toArray())[0]?.pending_sync).toBe(1);
    // Vuelve el servidor: Reintentar sube la sesion y habilita la charla.
    server.state.syncDown = false;
    await tap(sheetButton("Reintentar"));
    await settle(150);
    expect(sheetButton("Sí, conversar con Komi")?.disabled).toBe(false);
    expect((await db.sessions.toArray())[0]?.pending_sync).toBe(0);
    await tap(sheetButton("Sí, conversar con Komi"));
    await settle(100);
    expect(zen()).toBe("Ciclo Zen: Turno 1 de 5");
  });

  it("sin conexion: mensaje de sin conexion, con Reintentar, y sin abrir la charla", async () => {
    server.state.syncOffline = true;
    await savedSheet();
    expect(sheetButton("Sí, conversar con Komi")?.disabled).toBe(true);
    expect(sheet()?.textContent).toContain("No hay conexión con el servidor");
    expect(sheetButton("Reintentar")).not.toBeNull();
    server.state.syncOffline = false;
    await tap(sheetButton("Reintentar"));
    await settle(150);
    expect(sheetButton("Sí, conversar con Komi")?.disabled).toBe(false);
  });

  it("sesion no validada por el servidor (below_50_percent): no se ofrece la charla, sin Reintentar y sin el codigo", async () => {
    server.state.rejectSessionsWith = "below_50_percent";
    await savedSheet();
    expect(sheetButton("Sí, conversar con Komi")?.disabled).toBe(true);
    expect(sheet()?.textContent).toContain("El servidor no pudo validar esta sesión");
    expect(sheet()?.textContent).not.toContain("below_50_percent");
    expect(sheetButton("Reintentar")).toBeNull();
    expect(server.startCalls()).toHaveLength(0);
    // La lectura sigue guardada y el lector puede volver al jardin.
    expect(await db.sessions.count()).toBe(1);
    await tap(sheetButton("Por hoy no, volver al jardín"));
    expect(sheet()).toBeNull();
  });

  it("mientras sincroniza: 'Sincronizando tu sesion' y el boton deshabilitado hasta tener respuesta", async () => {
    const hold = deferred();
    const slow: typeof fetch = async (input, init) => {
      await hold.promise;
      return server.fetchFn(input, init);
    };
    const ctx = await mountApp([book()], { fetchFn: slow });
    await finishPhysical(ctx, 600_000);
    await enterPage("90");
    expect(sheetButton("Sí, conversar con Komi")?.disabled).toBe(true);
    expect(sheet()?.textContent).toContain("Sincronizando tu sesión");
    hold.resolve();
    await settle(150);
    expect(sheetButton("Sí, conversar con Komi")?.disabled).toBe(false);
    expect(sheet()?.textContent).not.toContain("Sincronizando tu sesión");
  });

  it("sin conexion: si el lector abre la charla despues, la pantalla de la charla usa el mismo motivo", async () => {
    await savedSheet();
    const open = sheetButton("Sí, conversar con Komi");
    expect(open?.disabled).toBe(false);
    server.state.syncOffline = true;
    await db.sessions.toCollection().modify({ pending_sync: 1 });
    await tap(open);
    await settle(150);
    expect(screenText()).toContain("No hay conexión con el servidor");
    expect(chatButton("Reintentar")).not.toBeNull();
    await tap(chatButton("Volver al jardín"));
    await settle();
    expect(await db.sessions.count()).toBe(1);
    expect(await db.reflections.count()).toBe(0);
  });

  it("Por hoy no, volver al jardin sigue yendo al Dashboard sin abrir la charla", async () => {
    const ctx = await savedSheet();
    await tap(sheetButton("Por hoy no, volver al jardín"));
    expect(sheet()).toBeNull();
    expect(ctx.root.querySelector(".dashboard")).not.toBeNull();
    expect(server.startCalls()).toHaveLength(0);
  });

  it("salir a mitad de la charla pide confirmacion y luego vuelve al Dashboard", async () => {
    const ctx = await savedSheet();
    await tap(sheetButton("Sí, conversar con Komi"));
    await settle(100);
    await tap(chatButton("Volver al jardín"));
    expect(sheet()?.textContent).toContain("Si sales ahora, no podrás retomar esta charla.");
    await tap(chatButton("Salir de todos modos"));
    await settle();
    expect(ctx.root.querySelector(".dashboard")).not.toBeNull();
    expect(server.messageCalls()).toHaveLength(0);
  });

  it("los registros de la sesion ya no existen cuando se abre la charla", async () => {
    await savedSheet();
    expect(await db.meta.get(META_KEYS.activeSession)).toBeUndefined();
    expect(await db.meta.get(META_KEYS.activeSessionProgress)).toBeUndefined();
  });

  it("la recarga del Service Worker se aplaza solo durante el streaming", async () => {
    const ctx = await savedSheet();
    await tap(sheetButton("Sí, conversar con Komi"));
    await settle(100);
    expect(ctx.gate.isBlocked()).toBe(false);
    const hold = deferred();
    server.reply({ kind: "ok", chunks: ["Uno ", "dos"], hold });
    await typeMessage("Hola");
    await tap(chatButton("Enviar"));
    await settle(60);
    expect(ctx.gate.isBlocked()).toBe(true);
    hold.resolve();
    await settle(100);
    expect(ctx.gate.isBlocked()).toBe(false);
  });

  it("cerrar la app durante el streaming cancela la peticion, no guarda el intercambio y suelta la recarga", async () => {
    const ctx = await savedSheet();
    await tap(sheetButton("Sí, conversar con Komi"));
    await settle(100);
    server.reply({ kind: "hang", before: ["Empiezo"] });
    await typeMessage("Hola");
    await tap(chatButton("Enviar"));
    await settle(60);
    mounted?.unmount();
    mounted = null;
    await settle(60);
    expect(server.state.cancelled).toBeGreaterThan(0);
    expect(server.chatOf((await db.sessions.toArray())[0]?.id ?? "")).toMatchObject({ turn_count: 1 });
    expect(await db.reflections.toCollection().first()).toMatchObject({ turn_count: 1, is_closed: false });
    expect(ctx.gate.isBlocked()).toBe(false);
  });
});
