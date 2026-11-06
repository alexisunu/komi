// Integracion de Mi Jardin con la app real: Dexie, epubjs y la cola de sincronizacion.

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type { KomiDatabase } from "./data/local_db/dexieDatabase";
import { createLocalProfileRepository } from "./data/local_db/localProfileRepository";
import { createApiClient } from "./data/network/apiClient";
import { buildEpub } from "./test/epubFixture";
import { createTestDb, fakeClock, uuid } from "./test/db";
import { chooseFile, render, typeInto } from "./test/render";

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

interface SyncBody {
  books: Array<{ id: string; title: string; format_type: string; sunflower_variant: string }>;
  sessions: unknown[];
}

/** Servidor falso: acepta lo que llegue a /profile/sync/. */
function serverFetch() {
  const bodies: SyncBody[] = [];
  const fetchFn = vi.fn<typeof fetch>(async (_url, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as SyncBody;
    bodies.push(body);
    return new Response(
      JSON.stringify({
        books: { accepted: (body.books ?? []).map((b) => ({ id: b.id, result: "created" })), rejected: [] },
        sessions: { accepted: [], rejected: [] },
        server_books: [],
        streak: { current: 0, longest: 0, last_valid_session_date: null },
      }),
      { status: 200 },
    );
  });
  return { fetchFn, bodies };
}

async function mountApp(fetchFn: ReturnType<typeof serverFetch>["fetchFn"]) {
  const profiles = createLocalProfileRepository(db, fakeClock(), undefined);
  await profiles.createProfile({
    profile_id: PROFILE,
    daily_goal_minutes: 15,
    preferred_moment: "MORNING",
    ai_reflection_style: "DEEP_ANALYSIS",
  });
  await profiles.updateProfile({ onboarding_synced: true });
  const api = createApiClient({ baseUrl: "https://api.komi.test", fetchFn, getProfileId: () => PROFILE });
  mounted = render(<App options={{ db, api }} />);
  await settle();
  return mounted.container;
}

const settle = (ms = 60) => act(async () => new Promise((r) => setTimeout(r, ms)));
async function waitFor(condition: () => boolean | Promise<boolean>, ms = 4000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await condition()) return;
    await settle(30);
  }
  throw new Error("Se agoto la espera");
}
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
const inputs = () => [...document.querySelectorAll('input:not([type="file"])')] as HTMLInputElement[];

describe("plantar un libro fisico desde la app", () => {
  it("queda en Dexie, aparece en Mi Jardin y en el Dashboard, y se sube a /profile/sync/", async () => {
    const server = serverFetch();
    const root = await mountApp(server.fetchFn);
    await tap(navItem(root, "Mi Jardín"));
    await tap(byText(root, "button", "Plantar libro"));
    await tap(byText(document.body, "button", "Libro Físico"));
    typeInto(inputs()[0], "Kokoro");
    typeInto(inputs()[1], "Natsume Soseki");
    typeInto(inputs()[2], "264");
    await tap(byText(document.body, "button", "Plantar Semilla"));

    const stored = await db.books.toArray();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      title: "Kokoro",
      format_type: "PHYSICAL",
      total_pages: 264,
      sunflower_variant: "CLASSIC",
      progress_percentage: 0,
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(root.querySelector("h3")?.textContent).toBe("Kokoro");

    await waitFor(async () => (await db.books.toArray())[0]?.pending_sync === 0);
    expect(server.bodies.at(-1)?.books[0]).toMatchObject({ title: "Kokoro", sunflower_variant: "CLASSIC" });

    await tap(navItem(root, "Lectura"));
    expect(root.querySelector(".dashboard__book-title")?.textContent).toBe("Kokoro");
    // Con un libro fisico en curso, "Comenzar Lectura" ya esta activo (bloque 4).
    expect((byText(root, "button", "Comenzar Lectura") as HTMLButtonElement).disabled).toBe(false);
  });

  it("sin red el libro queda guardado y pendiente de envio", async () => {
    const fetchFn = vi.fn<typeof fetch>(() => Promise.reject(new TypeError("offline")));
    const root = await mountApp(fetchFn);
    await tap(navItem(root, "Mi Jardín"));
    await tap(byText(root, "button", "Plantar libro"));
    await tap(byText(document.body, "button", "Libro Físico"));
    typeInto(inputs()[0], "Kokoro");
    typeInto(inputs()[1], "Soseki");
    typeInto(inputs()[2], "100");
    await tap(byText(document.body, "button", "Plantar Semilla"));
    await settle();
    const [book] = await db.books.toArray();
    expect(book?.pending_sync).toBe(1);
    expect(root.querySelector("h3")?.textContent).toBe("Kokoro");
  });

  it("poner en barbecho y volver a sembrar cambia de pestaña y se sincroniza", async () => {
    const server = serverFetch();
    const root = await mountApp(server.fetchFn);
    await tap(navItem(root, "Mi Jardín"));
    await tap(byText(root, "button", "Plantar libro"));
    await tap(byText(document.body, "button", "Libro Físico"));
    typeInto(inputs()[0], "Kokoro");
    typeInto(inputs()[1], "Soseki");
    typeInto(inputs()[2], "100");
    await tap(byText(document.body, "button", "Plantar Semilla"));

    await tap(root.querySelector('[aria-label="Poner en barbecho Kokoro"]'));
    expect((await db.books.toArray())[0]?.status).toBe("FALLOW");
    expect(root.querySelectorAll("h3")).toHaveLength(0);
    await tap(root.querySelector("#garden-tab-fallow"));
    expect(root.querySelector("h3")?.textContent).toBe("Kokoro");

    await tap(root.querySelector('[aria-label="Volver a sembrar Kokoro"]'));
    expect((await db.books.toArray())[0]?.status).toBe("ACTIVE");
    await waitFor(() => server.bodies.some((b) => b.books.some((x) => (x as { status?: string }).status === "FALLOW")));
  });
});

describe("plantar un EPUB desde la app (epubjs real)", () => {
  it("valida, prepara las locations, guarda el archivo y deja el libro activo", async () => {
    const server = serverFetch();
    const root = await mountApp(server.fetchFn);
    await tap(navItem(root, "Mi Jardín"));
    await tap(byText(root, "button", "Plantar libro"));

    const bytes = new Uint8Array(buildEpub({ title: "Ficciones", creator: "Jorge Luis Borges" }));
    await chooseFile(document.querySelector('input[type="file"]'), new File([bytes], "ficciones.epub"));
    await waitFor(() => inputs()[0]?.value === "Ficciones");
    expect(inputs().map((i) => i.value)).toEqual(["Ficciones", "Jorge Luis Borges"]);

    await tap(byText(document.body, "button", "Plantar Semilla"));
    await waitFor(() => document.querySelector('[role="dialog"]') === null);

    const [book] = await db.books.toArray();
    expect(book).toMatchObject({ title: "Ficciones", author: "Jorge Luis Borges", format_type: "EPUB" });
    const file = await db.epub_files.get(book?.id ?? "");
    expect(file?.size_bytes).toBe(bytes.byteLength);
    expect(JSON.parse(file?.locations ?? "[]").length).toBeGreaterThan(1);
    expect(root.querySelector(".book-card")?.textContent).toContain("EPUB");
    // El .epub nunca viaja al servidor (CLAUDE.md 6).
    await waitFor(() => server.bodies.length > 0);
    expect(JSON.stringify(server.bodies)).not.toContain("locations");
    expect(server.bodies[0]?.books[0]?.format_type).toBe("EPUB");
  });

  it("un archivo que no es epub muestra el aviso y no guarda nada", async () => {
    const root = await mountApp(serverFetch().fetchFn);
    await tap(navItem(root, "Mi Jardín"));
    await tap(byText(root, "button", "Plantar libro"));
    await chooseFile(document.querySelector('input[type="file"]'), new File(["hola"], "nota.epub"));
    await waitFor(() => document.querySelector('[role="alert"]') !== null);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("no parece un libro .epub");
    expect(await db.books.count()).toBe(0);
  });

  it("un EPUB sin archivo (purgado) avisa en su tarjeta y se puede reimportar", async () => {
    const root = await mountApp(serverFetch().fetchFn);
    await tap(navItem(root, "Mi Jardín"));
    await tap(byText(root, "button", "Plantar libro"));
    const bytes = new Uint8Array(buildEpub());
    await chooseFile(document.querySelector('input[type="file"]'), new File([bytes], "libro.epub"));
    await waitFor(() => inputs()[0]?.value !== "" && inputs().length > 0);
    await tap(byText(document.body, "button", "Plantar Semilla"));
    await waitFor(() => document.querySelector('[role="dialog"]') === null);

    const [book] = await db.books.toArray();
    await db.epub_files.delete(book?.id ?? ""); // Safari lo purgo
    await tap(navItem(root, "Lectura"));
    await tap(navItem(root, "Mi Jardín"));
    await waitFor(() => root.querySelector(".book-card__notice") !== null);
    expect(root.querySelector(".book-card__notice")?.textContent).toContain(
      "Reimportar archivo .epub para continuar en el 0%",
    );

    await chooseFile(root.querySelector('.book-card input[type="file"]'), new File([bytes], "libro.epub"));
    await waitFor(() => root.querySelector(".book-card__notice") === null);
    expect(await db.epub_files.get(book?.id ?? "")).toBeDefined();
  });
});
