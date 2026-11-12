// Integracion de la Fase 5.3: dispositivo vacio -> "Ya tengo un codigo" -> Dashboard con los datos
// recuperados, y Ajustes con el codigo y "volver a traer mis datos". Dexie y la app son reales;
// el servidor (solo GET /profile/sync/restore/) y el despertar son falsos.

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type { KomiDatabase } from "./data/local_db/dexieDatabase";
import { createLocalProfileRepository } from "./data/local_db/localProfileRepository";
import { formatLocalWallClock } from "./data/local_db/sessionRules";
import { createApiClient } from "./data/network/apiClient";
import { createTestDb, fakeClock, uuid } from "./test/db";
import type { WakeService } from "./data/network/wakeService";
import { createFakeWake, noWake } from "./test/noWake";
import { render, typeInto } from "./test/render";
import {
  BOOK_EPUB,
  BOOK_PHYSICAL,
  RESTORE_PROFILE_ID,
  restoreBody,
  serverBook,
  serverSession,
} from "./test/restoreFixture";

let db: KomiDatabase;
let mounted: ReturnType<typeof render> | null = null;

beforeEach(() => {
  db = createTestDb();
  document.documentElement.removeAttribute("data-theme");
  localStorage.clear();
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
  localStorage.clear();
  vi.unstubAllGlobals();
});

const settle = (ms = 80) => act(async () => new Promise((r) => setTimeout(r, ms)));
async function tap(el: Element | null | undefined) {
  if (!el) throw new Error("Elemento no encontrado");
  await act(async () => {
    (el as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 60));
  });
}
const byText = (root: ParentNode, selector: string, text: string) =>
  [...root.querySelectorAll(selector)].find((el) => el.textContent?.trim().startsWith(text)) ?? null;

interface Server {
  body: Record<string, unknown>;
  status: number | null;
  calls: Array<{ url: string; method: string; profile: string | undefined }>;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function mountApp(server: Server, wake: WakeService = noWake) {
  const fetchFn = vi.fn<typeof fetch>(async (input, init) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    server.calls.push({ url: String(input), method: init?.method ?? "GET", profile: headers["X-Profile-Id"] });
    if (server.status !== null) return json(server.status, { detail: "x" });
    if (String(input).endsWith("/profile/sync/restore/")) {
      if (headers["X-Profile-Id"] !== RESTORE_PROFILE_ID) return json(401, { detail: "Perfil no valido." });
      return json(200, server.body);
    }
    return json(404, { detail: "No encontrado." });
  });
  const profiles = createLocalProfileRepository(db, fakeClock(), undefined);
  const api = createApiClient({
    baseUrl: "https://api.komi.test",
    fetchFn,
    getProfileId: async () => (await profiles.getProfile())?.profile_id ?? null,
  });
  mounted = render(<App options={{ db, api, wake }} />);
  await settle();
  return mounted.container;
}

/** Fecha local de hoy (la racha caduca si la ultima sesion fue hace mas de un dia). */
const today = () => formatLocalWallClock(new Date()).slice(0, 10);

const newServer = (body: Record<string, unknown> = restoreBody()): Server => ({ body, status: null, calls: [] });
const codeField = (root: HTMLElement) => root.querySelector<HTMLInputElement>("#recovery-code");

async function recoverWith(root: HTMLElement, code: string) {
  await tap(byText(root, "button", "Ya tengo un código de recuperación"));
  typeInto(codeField(root), code);
  await tap(byText(root, "button", "Recuperar"));
  await settle(120);
}

describe("dispositivo vacio", () => {
  it("la bienvenida ofrece 'Ya tengo un código de recuperación'", async () => {
    const root = await mountApp(newServer());
    expect(byText(root, "button", "Comenzar")).not.toBeNull();
    expect(byText(root, "button", "Ya tengo un código de recuperación")).not.toBeNull();
  });

  it("con un codigo valido entra directo al Dashboard, sin pasar por las 5 preguntas", async () => {
    const server = newServer();
    const root = await mountApp(server);
    await recoverWith(root, RESTORE_PROFILE_ID);
    expect(root.querySelector('[data-screen="recover"]')).toBeNull();
    expect(root.querySelector('[data-screen="welcome"]')).toBeNull();
    expect(root.querySelector(".dashboard")).not.toBeNull();
    expect(byText(root, "button", "Comenzar lectura")).not.toBeNull();
  });

  it("guarda el perfil, los libros, las sesiones y la charla en Dexie", async () => {
    const root = await mountApp(newServer());
    await recoverWith(root, RESTORE_PROFILE_ID);
    expect(await db.profile.get("local")).toMatchObject({
      profile_id: RESTORE_PROFILE_ID,
      daily_goal_minutes: 20,
      onboarding_synced: true,
    });
    expect(await db.books.count()).toBe(2);
    expect(await db.sessions.count()).toBe(2);
    expect(await db.reflections.count()).toBe(1);
    expect(localStorage.getItem("komi.profile_id")).toBe(RESTORE_PROFILE_ID);
  });

  it("solo hace UNA llamada (la de recuperar), con el codigo tecleado, y nada se vuelve a subir", async () => {
    const server = newServer();
    const root = await mountApp(server);
    await recoverWith(root, `  ${RESTORE_PROFILE_ID.toUpperCase()}  `);
    expect(server.calls).toEqual([
      { url: "https://api.komi.test/api/v1/profile/sync/restore/", method: "GET", profile: RESTORE_PROFILE_ID },
    ]);
  });

  it("el Dashboard usa la meta recuperada y el libro en curso", async () => {
    const root = await mountApp(newServer());
    await recoverWith(root, RESTORE_PROFILE_ID);
    expect(root.querySelector(".dashboard__book-title")?.textContent).toBe("Libro fisico");
    expect(root.querySelector(".dashboard__time")?.textContent).toBe("20:00");
  });

  it("la racha recuperada se guarda en local (el badge esta oculto en la v2)", async () => {
    const body = restoreBody({ streak: { current: 3, longest: 5, last_valid_session_date: today() } });
    const root = await mountApp(newServer(body));
    await recoverWith(root, RESTORE_PROFILE_ID);
    expect(root.querySelector(".streak-badge")).toBeNull();
    expect((await db.meta.get("streak_current"))?.value).toBe(3);
  });

  it("Mi Jardin muestra los dos libros recuperados", async () => {
    const root = await mountApp(newServer());
    await recoverWith(root, RESTORE_PROFILE_ID);
    await tap(byText(root, "button", "Mi Jardín"));
    expect(root.textContent).toContain("Libro fisico");
    expect(root.textContent).toContain("Libro EPUB");
  });

  it("un EPUB recuperado aparece sin archivo y pide volver a elegirlo (opcion A)", async () => {
    const root = await mountApp(newServer());
    await recoverWith(root, RESTORE_PROFILE_ID);
    await tap(byText(root, "button", "Mi Jardín"));
    expect(root.textContent).toContain("Reimportar archivo .epub para continuar en el 10%");
    expect(byText(root, "button", "Elegir archivo")).not.toBeNull();
    expect(await db.epub_files.count()).toBe(0);
  });

  it("si el EPUB es el libro en curso, el Dashboard avisa y no deja abrir el lector", async () => {
    const body = restoreBody({
      books: [
        serverBook(BOOK_EPUB, {
          title: "Libro EPUB",
          format_type: "EPUB",
          total_pages: null,
          current_page: 0,
          progress_percentage: 10,
          last_epub_cfi: "epubcfi(/6/4)",
        }),
      ],
      sessions: [],
      chats: [],
    });
    const root = await mountApp(newServer(body));
    await recoverWith(root, RESTORE_PROFILE_ID);
    expect(root.textContent).toContain("Falta el archivo .epub de «Libro EPUB»");
    expect((byText(root, "button", "Comenzar lectura") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("servidor dormido (plan gratuito)", () => {
  it("espera a que despierte y lo dice con 'Despertando a Komi'; al despertar, recupera", async () => {
    const fake = createFakeWake();
    let wakeUp!: (awake: boolean) => void;
    fake.hold(new Promise<boolean>((resolve) => (wakeUp = resolve)));
    fake.set("waking");
    const server = newServer();
    const root = await mountApp(server, fake.wake);
    await tap(byText(root, "button", "Ya tengo un código de recuperación"));
    typeInto(codeField(root), RESTORE_PROFILE_ID);
    await tap(byText(root, "button", "Recuperar"));
    expect(byText(root, "button", "Despertando a Komi")).not.toBeNull();
    expect(server.calls).toEqual([]); // todavia no salio a pedir el historial
    await act(async () => wakeUp(true));
    await settle(120);
    expect(server.calls).toHaveLength(1);
    expect(root.querySelector(".dashboard")).not.toBeNull();
  });
});

describe("codigos que no sirven", () => {
  it("un formato invalido no sale a la red y muestra el aviso generico", async () => {
    const server = newServer();
    const root = await mountApp(server);
    await recoverWith(root, "esto-no-es-un-codigo");
    expect(root.querySelector('[role="alert"]')?.textContent).toBe(
      "No encontramos ese código. Revísalo e inténtalo de nuevo.",
    );
    expect(server.calls).toEqual([]);
    expect(root.querySelector('[data-screen="recover"]')).not.toBeNull();
    expect(await db.profile.count()).toBe(0);
  });

  it("un codigo que el servidor no conoce da EXACTAMENTE el mismo aviso", async () => {
    const server = newServer();
    const root = await mountApp(server);
    await recoverWith(root, uuid(123));
    expect(server.calls).toHaveLength(1);
    expect(root.querySelector('[role="alert"]')?.textContent).toBe(
      "No encontramos ese código. Revísalo e inténtalo de nuevo.",
    );
    expect(await db.profile.count()).toBe(0);
    expect(await db.books.count()).toBe(0);
  });

  it("con el servidor caido avisa de la conexion y deja el dispositivo vacio", async () => {
    const server = newServer();
    server.status = 503;
    const root = await mountApp(server);
    await recoverWith(root, RESTORE_PROFILE_ID);
    expect(root.querySelector('[role="alert"]')?.textContent).toBe(
      "No pudimos conectar con Komi. Revisa tu conexión e inténtalo de nuevo.",
    );
    expect(await db.profile.count()).toBe(0);
  });

  it("una respuesta con la forma equivocada no escribe nada", async () => {
    const server = newServer(restoreBody({ books: [serverBook(BOOK_PHYSICAL, { status: "X" })] }));
    const root = await mountApp(server);
    await recoverWith(root, RESTORE_PROFILE_ID);
    expect(root.querySelector('[role="alert"]')?.textContent).toBe(
      "No pudimos recuperar tus datos. Inténtalo de nuevo en unos minutos.",
    );
    expect(await db.profile.count()).toBe(0);
    expect(await db.books.count()).toBe(0);
  });

  it("tras un fallo se puede corregir el codigo y recuperar", async () => {
    const server = newServer();
    const root = await mountApp(server);
    await recoverWith(root, uuid(123));
    typeInto(codeField(root), RESTORE_PROFILE_ID);
    await tap(byText(root, "button", "Recuperar"));
    await settle(120);
    expect(root.querySelector(".dashboard")).not.toBeNull();
  });
});

describe("Ajustes en un dispositivo con datos", () => {
  async function recovered(server: Server) {
    const root = await mountApp(server);
    await recoverWith(root, RESTORE_PROFILE_ID);
    await tap(root.querySelector('[aria-label="Ajustes"]'));
    return root;
  }

  it("muestra el codigo de recuperacion del dispositivo con su aviso", async () => {
    const root = await recovered(newServer());
    expect(root.querySelector('[data-testid="recovery-code"]')?.textContent).toBe(RESTORE_PROFILE_ID);
    expect(root.textContent).toContain("Quien tenga este código puede ver tus lecturas y charlas.");
  });

  it("'Volver a traer mis datos' sin novedades dice que esta al dia y no duplica nada", async () => {
    const server = newServer();
    const root = await recovered(server);
    await tap(byText(root, "button", "Volver a traer mis datos"));
    await settle(120);
    expect(root.querySelector('[role="status"]')?.textContent).toBe("Tus datos ya están al día en este dispositivo.");
    expect(await db.books.count()).toBe(2);
    expect(await db.sessions.count()).toBe(2);
  });

  it("trae lo que falta (un libro, una sesion y mas racha) y el Dashboard se actualiza sin cambiar de pantalla", async () => {
    const server = newServer(restoreBody({ streak: { current: 3, longest: 5, last_valid_session_date: today() } }));
    const root = await recovered(server);
    expect(root.querySelector(".dashboard__book-title")?.textContent).toBe("Libro fisico");
    expect((await db.meta.get("streak_current"))?.value).toBe(3);
    server.body = restoreBody({
      streak: { current: 7, longest: 7, last_valid_session_date: today() },
      books: [
        ...(restoreBody()["books"] as Array<Record<string, unknown>>),
        // Mas reciente que los otros: pasa a ser el libro en curso del Dashboard.
        serverBook(uuid(903), { title: "Libro nuevo", updated_at: "2026-11-06T10:00:00Z" }),
      ],
      sessions: [
        ...(restoreBody()["sessions"] as Array<Record<string, unknown>>),
        serverSession(uuid(913), uuid(903)),
      ],
    });
    await tap(byText(root, "button", "Volver a traer mis datos"));
    await settle(120);
    expect(root.querySelector('[role="status"]')?.textContent).toBe("Recuperamos 1 libro y 1 sesión.");
    expect(await db.books.count()).toBe(3);
    // Sin cambiar de pantalla: el libro nuevo ya esta en el Dashboard y la racha, en local.
    expect(root.querySelector(".dashboard__book-title")?.textContent).toBe("Libro nuevo");
    expect((await db.meta.get("streak_current"))?.value).toBe(7);
    await tap(root.querySelector('[aria-label="Cerrar ajustes"]'));
    await tap(byText(root, "button", "Mi Jardín"));
    expect(root.textContent).toContain("Libro nuevo");
  });

  it("si el servidor no responde, avisa y no toca lo que ya hay", async () => {
    const server = newServer();
    const root = await recovered(server);
    server.status = 503;
    await tap(byText(root, "button", "Volver a traer mis datos"));
    await settle(120);
    expect(root.querySelector('[role="alert"]')?.textContent).toBe(
      "No pudimos conectar con Komi. Revisa tu conexión e inténtalo de nuevo.",
    );
    expect(await db.books.count()).toBe(2);
  });
});
