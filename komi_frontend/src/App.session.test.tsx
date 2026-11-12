// Integracion del bloque 4: iniciar la sesion de un libro fisico, la pantalla de concentracion sin
// navegacion, "Terminar sesión", la gracia, la pantalla provisional y "Leer este libro".
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
/** La hoja post-lectura es un dialogo fuera del contenedor de la app. */
const sheet = () => document.querySelector('[role="dialog"]');
const sheetTitle = () => sheet()?.querySelector("h2")?.textContent;
async function submitPage(page: string) {
  typeInto(sheet()?.querySelector("input"), page);
  await tap(byText(sheet() as HTMLElement, "button", "Actualizar Girasol"));
  await settle();
}
const byLabel = (root: ParentNode, label: string) => root.querySelector(`[aria-label="${label}"]`);
const startButton = (root: HTMLElement) => byText(root, "button", "Comenzar lectura") as HTMLButtonElement;

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

  it("Terminar sesión con 5 minutos o mas: abre la hoja post-lectura directo y aun no guarda nada", async () => {
    const { root, env, wakeLock, gate } = await mountApp([book(1)]);
    await tap(startButton(root));
    env.advance(450_000); // 7:30: mas de 5 minutos, sin confirmacion
    await tap(byText(root, "button", "Terminar sesión"));
    await settle();
    expect(sheetTitle()).toBe("¿Hasta qué página llegaste?");
    expect(root.querySelector(".bottom-nav")).toBeNull();
    // Paso 1 abierto: la sesion sigue solo en el registro, la recarga sigue bloqueada.
    expect(await db.sessions.count()).toBe(0);
    expect((await storedSession())?.finalSec).toBe(450);
    expect(gate.isBlocked()).toBe(true);
    expect(wakeLock.release).toHaveBeenCalled();
  });

  it("Paso 1 -> guardar -> Paso 2: guarda sesion y avance, borra el registro y suelta la recarga", async () => {
    const { root, env, gate } = await mountApp([book(1)]);
    await tap(startButton(root));
    env.advance(600_000);
    await tap(byText(root, "button", "Terminar sesión"));
    await settle();
    expect(sheet()?.querySelector("input")?.value).toBe("30"); // ultima pagina guardada
    await submitPage("60");

    const sessions = await db.sessions.toArray();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      session_status: "COMPLETED",
      actual_duration_sec: 600,
      current_page: 60,
      progress_percentage: null,
    });
    expect(await db.books.get(uuid(1))).toMatchObject({ current_page: 60, progress_percentage: 20 });
    expect(await storedSession()).toBeNull();
    expect(gate.isBlocked()).toBe(false);
    expect(sheet()?.textContent).toContain("¿Quieres charlar un poco sobre lo que acabas de leer?");
    expect((await db.meta.get(META_KEYS.streakCurrent))?.value).toBe(1);
  });

  it("al cerrar el Paso 2 con Por hoy no vuelve al Dashboard con la racha y el girasol actualizados", async () => {
    const { root, env } = await mountApp([book(1)]);
    await tap(startButton(root));
    env.advance(900_000 + 5);
    await settle(320);
    await settle();
    await submitPage("120");
    await tap(byText(sheet() as HTMLElement, "button", "Por hoy no, volver al jardín"));
    expect(sheet()).toBeNull();
    expect(root.querySelector(".dashboard")).not.toBeNull();
    expect(root.querySelector(".bottom-nav")).not.toBeNull();
    expect(root.querySelector(".streak-badge")).toBeNull(); // oculta en la v2; la racha sigue guardada
    expect((await db.meta.get(META_KEYS.streakCurrent))?.value).toBe(1);
    expect(root.querySelector('[role="img"]')?.getAttribute("aria-label")).toContain("40 por ciento");
  });

  it("cerrar la app en el Paso 1 sin pulsar nada no pierde la sesion: la hoja reaparece al reabrir", async () => {
    const first = await mountApp([book(1)]);
    await tap(startButton(first.root));
    first.env.advance(600_000);
    await tap(byText(first.root, "button", "Terminar sesión"));
    await settle();
    expect(sheetTitle()).toBe("¿Hasta qué página llegaste?");
    expect(await db.sessions.count()).toBe(0);

    mounted?.unmount();
    expect(sheet()).toBeNull();
    const again = await mountApp([], first.env);
    await settle();
    expect(sheetTitle()).toBe("¿Hasta qué página llegaste?");
    expect(again.gate.isBlocked()).toBe(true);
    await submitPage("45");
    expect((await db.sessions.toArray())[0]).toMatchObject({ actual_duration_sec: 600, current_page: 45 });
    expect(await storedSession()).toBeNull();
    expect(again.gate.isBlocked()).toBe(false);
  });

  it("Terminar sesión con menos de 5 minutos muestra el aviso; Seguir leyendo no cambia nada", async () => {
    const { root, env } = await mountApp([book(1)]);
    await tap(startButton(root));
    env.advance(200_000);
    await tap(byText(root, "button", "Terminar sesión"));
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("El tiempo mínimo es 5 min");
    await tap(byText(document.body, "button", "Seguir leyendo"));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(root.querySelector("[role=timer]")).not.toBeNull();
    expect(await storedSession()).not.toBeNull();
  });

  it("Descartar vuelve al Dashboard sin guardar nada", async () => {
    const { root, env, gate } = await mountApp([book(1)]);
    await tap(startButton(root));
    env.advance(200_000);
    await tap(byText(root, "button", "Terminar sesión"));
    await tap(byText(document.body, "button", "Descartar"));
    expect(root.querySelector(".dashboard")).not.toBeNull();
    expect(root.querySelector(".bottom-nav")).not.toBeNull();
    expect(await db.sessions.count()).toBe(0);
    expect(await storedSession()).toBeNull();
    expect(gate.isBlocked()).toBe(false);
  });

  it("Descartar no guarda nada aunque con el aviso abierto se pasen los 5 minutos", async () => {
    const { root, env, gate } = await mountApp([book(1)]);
    await tap(startButton(root));
    env.advance(200_000);
    await tap(byText(root, "button", "Terminar sesión"));
    env.advance(300_000); // 500 s: ya hay 5 minutos, pero el lector eligio descartar
    await tap(byText(document.body, "button", "Descartar"));
    await settle();
    expect(root.querySelector(".dashboard")).not.toBeNull();
    expect(await db.sessions.count()).toBe(0);
    expect(await storedSession()).toBeNull();
    expect(gate.isBlocked()).toBe(false);
  });

  it("Seguir leyendo reanuda la sesion y despues, con 5 minutos, termina directo", async () => {
    const { root, env } = await mountApp([book(1)]);
    await tap(startButton(root));
    env.advance(200_000);
    await tap(byText(root, "button", "Terminar sesión"));
    await tap(byText(document.body, "button", "Seguir leyendo"));
    env.advance(100_000); // 300 s exactos
    await tap(byText(root, "button", "Terminar sesión"));
    await settle();
    expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain("El tiempo mínimo");
    expect(sheetTitle()).toBe("¿Hasta qué página llegaste?");
    expect((await storedSession())?.finalSec).toBe(300);
  });

  it("al llegar el tiempo a 00:00 se abre la hoja post-lectura", async () => {
    const { root, env } = await mountApp([book(1)]);
    await tap(startButton(root));
    env.advance(900_000 + 5);
    await settle(320);
    await settle();
    expect(sheetTitle()).toBe("¿Hasta qué página llegaste?");
    await submitPage("90");
    expect(sheet()?.textContent).toContain("15:00de lectura");
    expect((await db.sessions.toArray())[0]).toMatchObject({ session_status: "COMPLETED" });
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
    env.advance(300_000);
    await act(async () => env.hide());
    env.advance(15_100);
    await act(async () => env.show());
    await settle();
    const notice = root.querySelector('[data-testid="session-invalidated"]');
    expect(notice?.textContent).toContain("más de 15 segundos");
    expect(root.querySelector(".bottom-nav")).not.toBeNull();
    const sessions = await db.sessions.toArray();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ session_status: "INVALIDATED_GRACE_EXPIRED", actual_duration_sec: 300 });
    expect((await db.books.get(uuid(1)))?.progress_percentage).toBe(10);
    expect(gate.isBlocked()).toBe(false);

    await tap(byText(root, "button", "Entendido"));
    expect(root.querySelector('[data-testid="session-invalidated"]')).toBeNull();
    expect(await storedSession()).toBeNull();
  });

  it("invalidada con menos de 5 minutos: se avisa pero no se guarda sesion alguna", async () => {
    const { root, env, gate } = await mountApp([book(1)]);
    await tap(startButton(root));
    env.advance(299_000);
    await act(async () => env.hide());
    env.advance(15_100);
    await act(async () => env.show());
    await settle();
    expect(root.querySelector('[data-testid="session-invalidated"]')?.textContent).toContain("más de 15 segundos");
    expect(await db.sessions.count()).toBe(0);
    expect((await db.books.get(uuid(1)))?.progress_percentage).toBe(10);
    expect(await storedSession()).toBeNull();
    expect(gate.isBlocked()).toBe(false);
  });
});

describe("recuperacion y hoja post-lectura sin trampas", () => {
  function saved(over: Partial<ActiveSession> = {}): ActiveSession {
    return {
      sessionId: uuid(500),
      bookId: uuid(1),
      plannedSec: 900,
      timerType: "TIMER",
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

  it("una sesion ya terminada y sin guardar abre la hoja, que guarda y deja salir", async () => {
    const env = createFocusEnv();
    await seedSession(saved({ finalSec: 600 }));
    const { root, gate } = await mountApp([book(1)], env);
    await settle();
    expect(sheetTitle()).toBe("¿Hasta qué página llegaste?");
    expect(gate.isBlocked()).toBe(true);
    await submitPage("50");
    await tap(byText(sheet() as HTMLElement, "button", "Por hoy no, volver al jardín"));
    expect(root.querySelector(".dashboard")).not.toBeNull();
    expect(await storedSession()).toBeNull();
    expect(gate.isBlocked()).toBe(false);
  });

  it("un registro sin el libro muestra un mensaje claro y una salida segura", async () => {
    const env = createFocusEnv();
    await seedSession(saved({ finalSec: 600, bookId: uuid(99) }));
    const { root, gate } = await mountApp([book(1)], env);
    await settle();
    expect(sheetTitle()).toBe("No encontramos esta sesión");
    await tap(byText(sheet() as HTMLElement, "button", "Volver al jardín"));
    expect(sheet()).toBeNull();
    expect(root.querySelector(".dashboard")).not.toBeNull();
    expect(await storedSession()).toBeNull();
    expect(gate.isBlocked()).toBe(false);
    expect(await db.sessions.count()).toBe(0);
  });

  it("aunque borrar el registro falle al salir de un mensaje de error, la hoja se cierra", async () => {
    const env = createFocusEnv();
    await seedSession(saved({ finalSec: 600, bookId: uuid(99) }));
    const { root } = await mountApp([book(1)], env);
    await settle();
    const remove = vi.spyOn(db.meta, "delete").mockRejectedValue(new Error("sin espacio"));
    await tap(byText(sheet() as HTMLElement, "button", "Volver al jardín"));
    expect(remove).toHaveBeenCalled();
    expect(sheet()).toBeNull();
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
    await seedSession(saved({ lastSeen: T0 + 330_000 }));
    env.set(T0 + 330_000 + 16_000);
    const { root } = await mountApp([book(1)], env);
    expect(root.querySelector('[data-testid="session-invalidated"]')).not.toBeNull();
    expect((await db.sessions.toArray())[0]).toMatchObject({
      session_status: "INVALIDATED_GRACE_EXPIRED",
      actual_duration_sec: 330,
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

describe("modo libre (la sesion se siembra: el selector del Dashboard llega despues)", () => {
  /** Registro libre con la ultima marca vista a `readSec` segundos de lectura; el reloj queda 3 s despues. */
  async function freeSession(readSec: number, over: Partial<ActiveSession> = {}) {
    const env = createFocusEnv();
    await seedSession({
      sessionId: uuid(500),
      bookId: uuid(1),
      plannedSec: 7200,
      timerType: "FREE",
      startedAt: T0,
      startedAtLocal: "2026-11-05T10:00:00",
      hiddenAt: null,
      lastSeen: T0 + readSec * 1000,
      finalSec: null,
      ...over,
    });
    env.set(T0 + readSec * 1000 + 3_000);
    return env;
  }
  const finishButton = (root: HTMLElement) => byText(root, "button", "Terminar sesión");
  const dialogText = () => document.querySelector('[role="dialog"]')?.textContent ?? "";

  it("se retoma con el cronometro hacia arriba y el subtitulo Modo libre", async () => {
    const env = await freeSession(600);
    const { root } = await mountApp([book(1)], env);
    expect(root.querySelector("[role=timer]")?.textContent).toBe("10:03");
    expect(root.querySelector("[role=timer]")?.getAttribute("aria-label")).toBe("Tiempo leído");
    expect(root.querySelector(".focus-timer__mode")?.textContent).toBe("Modo libre · 10 %");
    env.advance(57_000);
    await settle(320);
    expect(root.querySelector("[role=timer]")?.textContent).toBe("11:00");
  });

  it("pasada la hora el cronometro pasa a h:mm:ss", async () => {
    const env = await freeSession(3_700);
    const { root } = await mountApp([book(1)], env);
    expect(root.querySelector("[role=timer]")?.textContent).toBe("1:01:43");
  });

  it("con 10 minutos termina directo y se guarda con planned = actual", async () => {
    const env = await freeSession(600);
    const { root, gate } = await mountApp([book(1)], env);
    await tap(finishButton(root));
    expect(dialogText()).not.toContain("El tiempo mínimo");
    await settle();
    expect(sheetTitle()).toBe("¿Hasta qué página llegaste?");
    await submitPage("60");
    const [stored] = await db.sessions.toArray();
    expect(stored).toMatchObject({ session_status: "COMPLETED", planned_duration_sec: 603, actual_duration_sec: 603 });
    expect(await storedSession()).toBeNull();
    expect(gate.isBlocked()).toBe(false);
  });

  it("menos de 5 minutos: aviso; Seguir leyendo reanuda y Descartar no guarda nada", async () => {
    const env = await freeSession(120);
    const { root, gate } = await mountApp([book(1)], env);
    await tap(finishButton(root));
    expect(dialogText()).toContain("El tiempo mínimo es 5 min");
    await tap(byText(document.body, "button", "Seguir leyendo"));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(root.querySelector("[role=timer]")).not.toBeNull();
    await tap(finishButton(root));
    await tap(byText(document.body, "button", "Descartar"));
    expect(root.querySelector(".dashboard")).not.toBeNull();
    expect(await db.sessions.count()).toBe(0);
    expect(await storedSession()).toBeNull();
    expect(gate.isBlocked()).toBe(false);
  });

  it("menos de 5 minutos con Terminé el libro: la ultima pagina guarda con planned = 300 y florece", async () => {
    const env = await freeSession(117); // 2:00 de lectura al abrir
    const { root } = await mountApp([book(1)], env);
    await tap(finishButton(root));
    await tap(byText(document.body, "button", "Terminé el libro"));
    await settle();
    expect(sheetTitle()).toBe("¿Hasta qué página llegaste?");
    await submitPage("300");
    const [stored] = await db.sessions.toArray();
    expect(stored).toMatchObject({ session_status: "COMPLETED", planned_duration_sec: 300, actual_duration_sec: 120 });
    expect(await db.books.get(uuid(1))).toMatchObject({ status: "BLOOMED", progress_percentage: 100 });
  });

  it("menos de 5 minutos con otra pagina que la ultima: no se guarda", async () => {
    const env = await freeSession(117);
    const { root } = await mountApp([book(1)], env);
    await tap(finishButton(root));
    await tap(byText(document.body, "button", "Terminé el libro"));
    await settle();
    await submitPage("299");
    expect(sheetTitle()).toBe("Sesión sin guardar");
    expect(await db.sessions.count()).toBe(0);
    expect((await db.books.get(uuid(1)))?.progress_percentage).toBe(10);
  });

  it("a las 2 horas se completa sola, abre la hoja y se guarda con 7200 s", async () => {
    const env = await freeSession(7_199);
    const { root } = await mountApp([book(1)], env);
    env.advance(2_000);
    await settle(320);
    await settle();
    expect(sheetTitle()).toBe("¿Hasta qué página llegaste?");
    expect((await storedSession())?.finalSec).toBe(7200);
    await submitPage("200");
    expect((await db.sessions.toArray())[0]).toMatchObject({ planned_duration_sec: 7200, actual_duration_sec: 7200 });
    void root;
  });

  it("gracia: mas de 15 s fuera con 5 minutos o mas se guarda invalidada con planned = actual", async () => {
    const env = await freeSession(397); // 6:40 al abrir
    const { root, gate } = await mountApp([book(1)], env);
    await act(async () => env.hide());
    expect(root.querySelector(".grace-banner")?.textContent).toContain("15 s");
    env.advance(15_100);
    await act(async () => env.show());
    await settle();
    expect(root.querySelector('[data-testid="session-invalidated"]')).not.toBeNull();
    const [stored] = await db.sessions.toArray();
    expect(stored).toMatchObject({
      session_status: "INVALIDATED_GRACE_EXPIRED",
      planned_duration_sec: 400,
      actual_duration_sec: 400,
    });
    expect((await db.books.get(uuid(1)))?.progress_percentage).toBe(10);
    expect(gate.isBlocked()).toBe(false);
  });

  it("gracia: con menos de 5 minutos se avisa pero no se guarda ni se envia", async () => {
    const env = await freeSession(100);
    const { root, gate } = await mountApp([book(1)], env);
    await act(async () => env.hide());
    env.advance(15_100);
    await act(async () => env.show());
    await settle();
    expect(root.querySelector('[data-testid="session-invalidated"]')).not.toBeNull();
    expect(await db.sessions.count()).toBe(0);
    expect(await storedSession()).toBeNull();
    expect(gate.isBlocked()).toBe(false);
  });

  it("un registro guardado antes del modo libre, sin timerType, se retoma como temporizador", async () => {
    const env = createFocusEnv();
    await seedSession({
      sessionId: uuid(500),
      bookId: uuid(1),
      plannedSec: 900,
      startedAt: T0,
      startedAtLocal: "2026-11-05T10:00:00",
      hiddenAt: null,
      lastSeen: T0,
      finalSec: null,
    });
    env.advance(8_000);
    const { root } = await mountApp([book(1)], env);
    expect(root.querySelector("[role=timer]")?.textContent).toBe("14:52");
    expect(root.querySelector("[role=timer]")?.getAttribute("aria-label")).toBe("Tiempo restante");
    expect(root.querySelector(".focus-timer__mode")?.textContent).toBe("Temporizador · 10 %");
  });
});

describe("selector Temporizador | Libre en la app", () => {
  const radios = (root: HTMLElement) => [...root.querySelectorAll('[role="radio"]')] as HTMLButtonElement[];
  const checked = (root: HTMLElement) => radios(root).map((r) => r.getAttribute("aria-checked"));
  const timerMode = async () => (await db.meta.get(META_KEYS.timerMode))?.value;

  it("la clave de meta es timer_mode", () => {
    expect(META_KEYS.timerMode).toBe("timer_mode");
  });

  it("sin nada guardado empieza en Temporizador", async () => {
    const { root } = await mountApp([book(1)]);
    expect(checked(root)).toEqual(["true", "false"]);
    expect(root.querySelector(".dashboard__free")).toBeNull();
  });

  it("recuerda la ultima eleccion: con FREE guardado abre en Libre", async () => {
    await db.meta.put({ key: META_KEYS.timerMode, value: "FREE" });
    const { root } = await mountApp([book(1)]);
    await settle();
    expect(checked(root)).toEqual(["false", "true"]);
    expect(root.querySelector(".dashboard__free")?.textContent).toContain("Sin límite de tiempo");
    expect(root.querySelector("output")).toBeNull();
  });

  it.each([["OTRO"], [""], [7], [null], [{ mode: "FREE" }]])(
    "un valor guardado invalido (%j) cae a Temporizador",
    async (stored) => {
      await db.meta.put({ key: META_KEYS.timerMode, value: stored as never });
      const { root } = await mountApp([book(1)]);
      await settle();
      expect(checked(root)).toEqual(["true", "false"]);
      expect(root.querySelector("output")?.textContent).toBe("15:00");
    },
  );

  it("elegir un modo lo guarda en local y sobrevive a reabrir la app", async () => {
    const first = await mountApp([book(1)]);
    await tap(radios(first.root)[1]);
    expect(await timerMode()).toBe("FREE");
    mounted?.unmount();
    const again = await mountApp([], first.env);
    await settle();
    expect(checked(again.root)).toEqual(["false", "true"]);
    await tap(radios(again.root)[0]);
    expect(await timerMode()).toBe("TIMER");
  });

  it("el modo no se sincroniza: solo vive en meta, no toca perfil ni libros", async () => {
    const { root } = await mountApp([book(1)]);
    await tap(radios(root)[1]);
    expect((await db.books.get(uuid(1)))?.pending_sync).toBe(0);
    expect(await db.sessions.count()).toBe(0);
  });

  it("empezar en Libre inicia una sesion FREE: cronometro en 00:00, sin tiempo programado y con el tope", async () => {
    const { root } = await mountApp([book(1)]);
    await tap(radios(root)[1]);
    await tap(startButton(root));
    expect(root.querySelector("[role=timer]")?.textContent).toBe("00:00");
    expect(root.querySelector(".focus-timer__mode")?.textContent).toBe("Modo libre · 10 %");
    expect(await storedSession()).toMatchObject({ timerType: "FREE", plannedSec: 7200 });
  });

  it("empezar en Temporizador sigue enviando TIMER con los minutos del selector", async () => {
    const { root } = await mountApp([book(1)]);
    await tap(byLabel(root, "Sumar 5 minutos"));
    await tap(startButton(root));
    expect(root.querySelector("[role=timer]")?.textContent).toBe("20:00");
    expect(root.querySelector(".focus-timer__mode")?.textContent).toBe("Temporizador · 10 %");
    expect(await storedSession()).toMatchObject({ timerType: "TIMER", plannedSec: 1200 });
  });

  it("al terminar una sesion libre y volver, el selector sigue en Libre", async () => {
    const { root, env } = await mountApp([book(1)]);
    await tap(radios(root)[1]);
    await tap(startButton(root));
    env.advance(600_000);
    await tap(byText(root, "button", "Terminar sesión"));
    await settle();
    await submitPage("60");
    await tap(byText(sheet() as HTMLElement, "button", "Por hoy no, volver al jardín"));
    expect(root.querySelector(".dashboard")).not.toBeNull();
    expect(checked(root)).toEqual(["false", "true"]);
  });
});
