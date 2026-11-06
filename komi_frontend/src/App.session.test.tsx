// Integracion del bloque 4: iniciar la sesion de un libro fisico, la pantalla de concentracion sin
// navegacion, "Terminé antes de tiempo", la gracia, la pantalla provisional y "Leer este libro".
// Dexie y la app son reales; el reloj, Page Visibility y wakeLock son falsos.

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type { KomiDatabase } from "./data/local_db/dexieDatabase";
import { META_KEYS } from "./data/local_db/localMetaRepository";
import { createLocalProfileRepository } from "./data/local_db/localProfileRepository";
import type { LocalBook } from "./data/local_db/types";
import { createApiClient } from "./data/network/apiClient";
import { createReloadGate, type ReloadGate } from "./pwa/reloadGate";
import { parseActiveSession, type ActiveSession } from "./services/focusSessionMachine";
import type { WakeLockService } from "./services/wakeLockService";
import { createTestDb, fakeClock, uuid } from "./test/db";
import { createFocusEnv, T0, type FocusEnv } from "./test/focusEnv";
import { render } from "./test/render";

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

function book(id: number, over: Partial<LocalBook> = {}): LocalBook {
  return {
    id: uuid(id),
    title: `Libro ${id}`,
    author: "Autora",
    format_type: "PHYSICAL",
    sunflower_variant: "CLASSIC",
    status: "ACTIVE",
    total_pages: 300,
    current_page: 30,
    progress_percentage: 10,
    last_epub_cfi: null,
    created_at: `2026-11-0${id}T00:00:00.000Z`,
    completed_at: null,
    updated_at: `2026-11-0${id}T00:00:00.000Z`,
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
const navItem = (root: HTMLElement, label: string) =>
  [...root.querySelectorAll(".bottom-nav__item")].find((b) => b.textContent === label);
const startButton = (root: HTMLElement) => byText(root, "button", "Comenzar Lectura") as HTMLButtonElement;

interface Setup {
  env: FocusEnv;
  gate: ReloadGate;
  reload: ReturnType<typeof vi.fn>;
  wakeLock: WakeLockService & { acquire: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };
}

/** Registro `active_session` tal como quedo en Dexie. */
async function storedSession(): Promise<ActiveSession | null> {
  return parseActiveSession((await db.meta.get(META_KEYS.activeSession))?.value);
}
async function seedSession(session: unknown): Promise<void> {
  await db.meta.put({ key: META_KEYS.activeSession, value: JSON.stringify(session) });
}

async function mountApp(books: LocalBook[], env: FocusEnv = createFocusEnv()) {
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
  const fetchFn = vi.fn<typeof fetch>(async () => new Response("{}", { status: 500 }));
  const api = createApiClient({ baseUrl: "https://api.komi.test", fetchFn, getProfileId: () => PROFILE });
  const reload = vi.fn();
  const gate = createReloadGate(reload);
  const wakeLock = { acquire: vi.fn(async () => {}), release: vi.fn(async () => {}) };
  mounted = render(
    <App options={{ db, api, focusEnv: { now: env.now, doc: env.doc, win: env.win }, gate, wakeLock: wakeLock as unknown as WakeLockService }} />,
  );
  await settle();
  const setup: Setup = { env, gate, reload, wakeLock: wakeLock as Setup["wakeLock"] };
  return { root: mounted.container, ...setup };
}

describe("Comenzar Lectura: precondiciones de CU-03", () => {
  it("se activa con un libro fisico en curso", async () => {
    const { root } = await mountApp([book(1)]);
    expect(startButton(root).disabled).toBe(false);
  });

  it.each([
    ["sin libros", [] as LocalBook[]],
    ["solo en barbecho", [book(1, { status: "FALLOW" })]],
    ["solo florecido", [book(1, { status: "BLOOMED", progress_percentage: 100 })]],
    ["un EPUB (llega con el lector)", [book(1, { format_type: "EPUB", total_pages: null })]],
  ])("queda deshabilitado %s", async (_name, books) => {
    const { root } = await mountApp(books);
    expect(startButton(root).disabled).toBe(true);
  });
});

describe("sesion de un libro fisico", () => {
  it("al comenzar: sin navegacion, reloj con el tiempo del selector, pantalla encendida y recarga bloqueada", async () => {
    const { root, gate, wakeLock } = await mountApp([book(1)]);
    await tap(startButton(root));
    expect(root.querySelector(".bottom-nav")).toBeNull();
    expect(root.querySelector("[role=timer]")?.textContent).toBe("15:00");
    expect(root.querySelector("h1")?.textContent).toBe("Libro 1");
    await settle();
    expect(await storedSession()).toMatchObject({ plannedSec: 900, bookId: uuid(1) });
    expect(gate.isBlocked()).toBe(true);
    expect(wakeLock.acquire).toHaveBeenCalled();
    expect(root.querySelector(".sunflower--breathing")).not.toBeNull();
  });

  it("usa los minutos del selector", async () => {
    const { root } = await mountApp([book(1)]);
    const plus = root.querySelector('[aria-label="Sumar 5 minutos"]');
    await tap(plus);
    await tap(startButton(root));
    expect((await storedSession())?.plannedSec).toBe(1200);
    expect(root.querySelector("[role=timer]")?.textContent).toBe("20:00");
  });

  it("el reloj sale de marcas de tiempo: un salto de 5 minutos se refleja en el siguiente repintado", async () => {
    const { root, env } = await mountApp([book(1)]);
    await tap(startButton(root));
    env.advance(5 * 60_000);
    await settle(320);
    expect(root.querySelector("[role=timer]")?.textContent).toBe("10:00");
  });

  it("tiene como maximo 4 bloques funcionales", async () => {
    const { root } = await mountApp([book(1)]);
    await tap(startButton(root));
    expect(root.querySelectorAll("[data-block]").length).toBeLessThanOrEqual(4);
  });

  it("Terminé antes de tiempo con el 50 % o mas: pasa a la pantalla provisional sin guardar sesion", async () => {
    const { root, env, wakeLock } = await mountApp([book(1)]);
    await tap(startButton(root));
    env.advance(450_000); // 7:30 de 15:00 = 50 %
    await tap(byText(root, "button", "Terminé antes de tiempo"));
    expect(root.querySelector("h1")?.textContent).toBe("Sesión terminada");
    expect(root.querySelector(".bottom-nav")).toBeNull();
    expect(root.textContent).toContain("Leíste 7 minutos");
    expect(await db.sessions.count()).toBe(0);
    expect(wakeLock.release).toHaveBeenCalled();
  });

  it("el boton de la pantalla provisional borra active_session y no hay bucle al reabrir", async () => {
    const first = await mountApp([book(1)]);
    await tap(startButton(first.root));
    first.env.advance(600_000);
    await tap(byText(first.root, "button", "Terminé antes de tiempo"));
    await settle();
    expect((await storedSession())?.finalSec).toBe(600);

    await tap(byText(first.root, "button", "Volver al jardín"));
    expect(await storedSession()).toBeNull();
    expect(first.gate.isBlocked()).toBe(false);
    expect(first.root.querySelector(".bottom-nav")).not.toBeNull();
    expect(first.root.querySelector("h1")?.textContent).toBe("Mi Jardín");

    // Reabrir la app: ya no vuelve a la pantalla provisional.
    mounted?.unmount();
    const again = await mountApp([], first.env);
    expect(again.root.querySelector("h1")?.textContent).not.toBe("Sesión terminada");
    expect(again.root.querySelector(".bottom-nav")).not.toBeNull();
  });

  it("Terminé antes de tiempo con menos del 50 % pide confirmacion; Seguir leyendo no cambia nada", async () => {
    const { root, env } = await mountApp([book(1)]);
    await tap(startButton(root));
    env.advance(200_000);
    await tap(byText(root, "button", "Terminé antes de tiempo"));
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("no se guarda ningún avance");
    await tap(byText(document.body, "button", "Seguir leyendo"));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(root.querySelector("[role=timer]")).not.toBeNull();
    expect(await storedSession()).not.toBeNull();
  });

  it("confirmar la cancelacion vuelve al Dashboard sin guardar nada", async () => {
    const { root, env, gate } = await mountApp([book(1)]);
    await tap(startButton(root));
    env.advance(200_000);
    await tap(byText(root, "button", "Terminé antes de tiempo"));
    await tap(byText(document.body, "button", "Cancelar sesión"));
    expect(root.querySelector(".dashboard")).not.toBeNull();
    expect(root.querySelector(".bottom-nav")).not.toBeNull();
    expect(await db.sessions.count()).toBe(0);
    expect(await storedSession()).toBeNull();
    expect(gate.isBlocked()).toBe(false);
  });

  it("si con la hoja abierta se supera el 50 %, confirmar ya no cancela: la sesion es valida", async () => {
    const { root, env } = await mountApp([book(1)]);
    await tap(startButton(root));
    env.advance(200_000);
    await tap(byText(root, "button", "Terminé antes de tiempo"));
    env.advance(300_000); // 500 s de 900 > 50 %
    await tap(byText(document.body, "button", "Cancelar sesión"));
    expect(root.querySelector("h1")?.textContent).toBe("Sesión terminada");
  });

  it("al llegar el tiempo a 00:00 se pasa a la pantalla provisional", async () => {
    const { root, env } = await mountApp([book(1)]);
    await tap(startButton(root));
    env.advance(900_000 + 5);
    await settle(320);
    expect(root.querySelector("h1")?.textContent).toBe("Sesión terminada");
    expect(root.textContent).toContain("Leíste 15 minutos");
  });
});

describe("periodo de gracia en pantalla", () => {
  it("al salir muestra el aviso y pausa la respiracion; al volver a tiempo todo sigue", async () => {
    const { root, env } = await mountApp([book(1)]);
    await tap(startButton(root));
    await act(async () => env.hide());
    expect(root.querySelector(".grace-banner")?.textContent).toContain("15 s");
    expect(root.querySelector(".sunflower--breathing-paused")).not.toBeNull();
    env.advance(14_000);
    await act(async () => env.show());
    expect(root.querySelector(".grace-banner")).toBeNull();
    expect(root.querySelector(".sunflower--breathing-paused")).toBeNull();
    expect(root.querySelector("[role=timer]")).not.toBeNull();
  });

  it("pasados 15 s se invalida: se guarda la sesion invalida, no cambia el libro y avisa", async () => {
    const { root, env, gate } = await mountApp([book(1)]);
    await tap(startButton(root));
    env.advance(60_000);
    await act(async () => env.hide());
    env.advance(15_100);
    await act(async () => env.show());
    await settle();
    const notice = root.querySelector('[data-testid="session-invalidated"]');
    expect(notice?.textContent).toContain("más de 15 segundos");
    expect(root.querySelector(".bottom-nav")).not.toBeNull();
    const sessions = await db.sessions.toArray();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ session_status: "INVALIDATED_GRACE_EXPIRED", actual_duration_sec: 60 });
    expect((await db.books.get(uuid(1)))?.progress_percentage).toBe(10);
    expect(gate.isBlocked()).toBe(false);

    await tap(byText(root, "button", "Entendido"));
    expect(root.querySelector('[data-testid="session-invalidated"]')).toBeNull();
    expect(await storedSession()).toBeNull();
  });
});

describe("recuperacion y pantalla provisional sin trampas", () => {
  function saved(over: Partial<ActiveSession> = {}): ActiveSession {
    return {
      sessionId: uuid(500),
      bookId: uuid(1),
      plannedSec: 900,
      startedAt: T0,
      startedAtLocal: "2026-11-05T10:00:00",
      hiddenAt: null,
      lastSeen: T0,
      finalSec: null,
      ...over,
    };
  }

  it("una sesion en curso guardada se retoma directamente en la pantalla de concentracion", async () => {
    const env = createFocusEnv();
    await seedSession(saved());
    env.advance(8_000);
    const { root, gate } = await mountApp([book(1)], env);
    expect(root.querySelector("[role=timer]")).not.toBeNull();
    expect(root.querySelector(".bottom-nav")).toBeNull();
    expect(gate.isBlocked()).toBe(true);
  });

  it("una sesion ya terminada y sin guardar abre la pantalla provisional, que siempre deja salir", async () => {
    const env = createFocusEnv();
    await seedSession(saved({ finalSec: 600 }));
    const { root, gate } = await mountApp([book(1)], env);
    expect(root.querySelector("h1")?.textContent).toBe("Sesión terminada");
    await tap(byText(root, "button", "Volver al jardín"));
    expect(root.querySelector("h1")?.textContent).toBe("Mi Jardín");
    expect(await storedSession()).toBeNull();
    expect(gate.isBlocked()).toBe(false);
  });

  it("aunque borrar el registro falle, el boton sale de la pantalla provisional", async () => {
    const env = createFocusEnv();
    await seedSession(saved({ finalSec: 600 }));
    const { root } = await mountApp([book(1)], env);
    const remove = vi.spyOn(db.meta, "delete").mockRejectedValue(new Error("sin espacio"));
    await tap(byText(root, "button", "Volver al jardín"));
    expect(remove).toHaveBeenCalled();
    expect(root.querySelector("h1")?.textContent).not.toBe("Sesión terminada");
    expect(root.querySelector(".bottom-nav")).not.toBeNull();
  });

  it("un registro corrupto no atrapa a nadie: se abre el Dashboard", async () => {
    const env = createFocusEnv();
    await seedSession({ sessionId: 7, plannedSec: "mucho" });
    const { root } = await mountApp([book(1)], env);
    expect(root.querySelector(".dashboard")).not.toBeNull();
    expect(root.querySelector(".bottom-nav")).not.toBeNull();
  });

  it("una sesion pasada de 15 s desde lastSeen se invalida al abrir y se avisa", async () => {
    const env = createFocusEnv();
    await seedSession(saved({ lastSeen: T0 + 30_000 }));
    env.set(T0 + 30_000 + 16_000);
    const { root } = await mountApp([book(1)], env);
    expect(root.querySelector('[data-testid="session-invalidated"]')).not.toBeNull();
    expect((await db.sessions.toArray())[0]).toMatchObject({
      session_status: "INVALIDATED_GRACE_EXPIRED",
      actual_duration_sec: 30,
    });
  });
});

describe("Leer este libro", () => {
  it("el Dashboard usa el libro elegido, lo guarda en meta y lo conserva al reabrir", async () => {
    const books = [book(1), book(2), book(3)]; // el mas reciente (3) es el de por defecto
    const { root, env } = await mountApp(books);
    expect(root.querySelector(".dashboard__book-title")?.textContent).toBe("Libro 3");

    await tap(navItem(root, "Mi Jardín"));
    const card = [...root.querySelectorAll(".book-card")].find((c) => c.textContent?.includes("Libro 1"));
    await tap(byText(card as HTMLElement, "button", "Leer este libro"));
    expect(await db.meta.get(META_KEYS.activeBookId)).toMatchObject({ value: uuid(1) });
    // El borde de acento pasa a la tarjeta elegida y su boton desaparece.
    expect(card?.getAttribute("data-active")).toBe("true");
    expect(byText(card as HTMLElement, "button", "Leer este libro")).toBeNull();

    await tap(navItem(root, "Lectura"));
    expect(root.querySelector(".dashboard__book-title")?.textContent).toBe("Libro 1");

    mounted?.unmount();
    const again = await mountApp([], env);
    expect(again.root.querySelector(".dashboard__book-title")?.textContent).toBe("Libro 1");
  });

  it("la sesion se inicia con el libro elegido", async () => {
    const { root } = await mountApp([book(1), book(2)]);
    await tap(navItem(root, "Mi Jardín"));
    const card = [...root.querySelectorAll(".book-card")].find((c) => c.textContent?.includes("Libro 1"));
    await tap(byText(card as HTMLElement, "button", "Leer este libro"));
    await tap(navItem(root, "Lectura"));
    await tap(startButton(root));
    await settle();
    expect((await storedSession())?.bookId).toBe(uuid(1));
  });

  it("si el libro elegido pasa a barbecho, el Dashboard vuelve a la regla por defecto", async () => {
    const { root } = await mountApp([book(1), book(2)]);
    await tap(navItem(root, "Mi Jardín"));
    const card = [...root.querySelectorAll(".book-card")].find((c) => c.textContent?.includes("Libro 1"));
    await tap(byText(card as HTMLElement, "button", "Leer este libro"));
    await tap(card?.querySelector('[aria-label^="Poner en barbecho"]'));
    await tap(navItem(root, "Lectura"));
    expect(root.querySelector(".dashboard__book-title")?.textContent).toBe("Libro 2");
  });

  it("un id guardado de un libro que ya no existe usa la regla por defecto", async () => {
    await db.meta.put({ key: META_KEYS.activeBookId, value: uuid(99) });
    const { root } = await mountApp([book(1), book(2)]);
    expect(root.querySelector(".dashboard__book-title")?.textContent).toBe("Libro 2");
  });
});
