// Integracion del bloque 5: el lector EPUB dentro de la app. Dexie y la app son reales; el reloj,
// Page Visibility, wakeLock y epubjs (que no dibuja en jsdom) son falsos. El motor real de epubjs
// se prueba en epubService.test.ts y se verifica a mano con libros reales (SRS 19.16).

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type { KomiDatabase } from "./data/local_db/dexieDatabase";
import { META_KEYS, readerPositionKey } from "./data/local_db/localMetaRepository";
import { createLocalProfileRepository } from "./data/local_db/localProfileRepository";
import type { LocalBook } from "./data/local_db/types";
import { createApiClient } from "./data/network/apiClient";
import { createReloadGate } from "./pwa/reloadGate";
import { parseReaderPosition, parseReadingProgress, PROGRESS_WRITE_MS } from "./services/readingTracker";
import type { WakeLockService } from "./services/wakeLockService";
import { createTestDb, fakeClock, uuid } from "./test/db";
import { createFocusEnv, type FocusEnv } from "./test/focusEnv";
import { createFakeReader, type FakeReader } from "./test/readerEnv";
import { render } from "./test/render";

let db: KomiDatabase;
let mounted: ReturnType<typeof render> | null = null;
const PROFILE = uuid(77);
const LOCATIONS = JSON.stringify(["epubcfi(/6/2!/4/2/1:0)", "epubcfi(/6/4!/4/2/1:0)"]);

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

function epubBook(id: number, over: Partial<LocalBook> = {}): LocalBook {
  return {
    id: uuid(id),
    title: `Kokoro ${id}`,
    author: "Natsume Soseki",
    format_type: "EPUB",
    sunflower_variant: "CLASSIC",
    status: "ACTIVE",
    total_pages: null,
    current_page: 0,
    progress_percentage: 12,
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
const sheet = () => document.querySelector('[role="dialog"]');
const sheetTitle = () => sheet()?.querySelector("h2")?.textContent;
const openButton = (root: HTMLElement) => byText(root, "button", "Abrir lector") as HTMLButtonElement;

async function putFile(bookId: string, locations: string | null = LOCATIONS) {
  await db.epub_files.put({
    book_id: bookId,
    data: new Uint8Array([1, 2, 3, 4]).buffer,
    size_bytes: 4,
    locations,
    created_at: "2026-11-01T00:00:00.000Z",
  });
}

async function storedProgress() {
  return parseReadingProgress((await db.meta.get(META_KEYS.activeSessionProgress))?.value);
}

interface MountOptions {
  files?: Array<{ bookId: string; locations?: string | null }>;
  env?: FocusEnv;
  reader?: FakeReader;
  epub?: { inspect: never; generateLocations: ReturnType<typeof vi.fn> };
}

async function mountApp(books: LocalBook[], options: MountOptions = {}) {
  const env = options.env ?? createFocusEnv();
  const fake = options.reader ?? createFakeReader();
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
  for (const f of options.files ?? []) await putFile(f.bookId, f.locations);
  const fetchFn = vi.fn<typeof fetch>(async () => new Response("{}", { status: 500 }));
  const api = createApiClient({ baseUrl: "https://api.komi.test", fetchFn, getProfileId: () => PROFILE });
  const gate = createReloadGate(vi.fn());
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
        ...(options.epub ? { epub: options.epub as never } : {}),
      }}
    />,
  );
  await settle();
  return { root: mounted.container, env, fake, gate, wakeLock };
}

describe("Abrir lector: precondiciones", () => {
  it("con un EPUB y su archivo, el boton dice Abrir lector y esta activo", async () => {
    const { root } = await mountApp([epubBook(1)], { files: [{ bookId: uuid(1) }] });
    expect(byText(root, "button", "Comenzar Lectura")).toBeNull();
    expect(openButton(root).disabled).toBe(false);
  });

  it("sin el archivo .epub queda deshabilitado y avisa", async () => {
    const { root } = await mountApp([epubBook(1)]);
    expect(openButton(root).disabled).toBe(true);
    expect(root.querySelector('[role="status"].app-notice')?.textContent).toContain(
      "Falta el archivo .epub de «Kokoro 1»",
    );
  });

  it("un EPUB en barbecho o florecido no se abre", async () => {
    const fallow = await mountApp([epubBook(1, { status: "FALLOW" })], { files: [{ bookId: uuid(1) }] });
    expect(openButton(fallow.root)?.disabled ?? true).toBe(true);
  });
});

describe("sesion EPUB", () => {
  it("abre el lector sin navegacion, con reloj en el encabezado y wakeLock", async () => {
    const { root, fake, wakeLock, gate } = await mountApp([epubBook(1)], { files: [{ bookId: uuid(1) }] });
    await tap(openButton(root));
    await settle();
    expect(root.querySelector(".epub-reader")).not.toBeNull();
    expect(root.querySelector(".bottom-nav")).toBeNull();
    expect(root.querySelector(".epub-reader__header [role=timer]")?.textContent).toBe("15:00");
    expect(wakeLock.acquire).toHaveBeenCalled();
    expect(gate.isBlocked()).toBe(true);
    expect(fake.open).toHaveBeenCalledTimes(1);
    const input = fake.inputs[0];
    expect(input?.locations).toBe(LOCATIONS);
    expect(input?.startCfi).toBeNull();
    expect(input?.theme).toMatchObject({ theme: "light", fontPx: 18 });
    expect(root.querySelectorAll("[data-block]").length).toBeLessThanOrEqual(4);
  });

  it("reanuda desde el ultimo CFI del libro", async () => {
    const { root, fake } = await mountApp([epubBook(1, { last_epub_cfi: "epubcfi(/6/4!/4/2/1:10)" })], {
      files: [{ bookId: uuid(1) }],
    });
    await tap(openButton(root));
    await settle();
    expect(fake.inputs[0]?.startCfi).toBe("epubcfi(/6/4!/4/2/1:10)");
  });

  it("si el libro no tiene locations las prepara con avance real antes de correr el reloj", async () => {
    let release: (json: string) => void = () => {};
    const progress: Array<(f: number) => void> = [];
    const generateLocations = vi.fn(
      (_data: ArrayBuffer, onProgress?: (f: number) => void) =>
        new Promise<string>((resolve) => {
          if (onProgress) progress.push(onProgress);
          release = resolve;
        }),
    );
    const { root, fake, env } = await mountApp([epubBook(1)], {
      files: [{ bookId: uuid(1), locations: null }],
      epub: { inspect: undefined as never, generateLocations },
    });
    await tap(openButton(root));
    expect(root.textContent).toContain("Preparando tu libro");
    expect(root.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("0");
    act(() => progress[0]?.(0.42));
    expect(root.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("42");
    // Mientras se prepara no hay sesion ni reloj.
    expect(await db.meta.get(META_KEYS.activeSession)).toBeUndefined();
    expect(root.querySelector(".bottom-nav")).toBeNull();
    env.advance(30_000);

    await act(async () => release(LOCATIONS));
    await settle();
    expect(root.querySelector(".epub-reader")).not.toBeNull();
    expect(root.querySelector("[role=timer]")?.textContent).toBe("15:00");
    expect((await db.epub_files.get(uuid(1)))?.locations).toBe(LOCATIONS);
    await vi.waitFor(() => expect(fake.inputs[0]?.locations).toBe(LOCATIONS));
  });

  it("si el archivo desaparece justo al abrir, avisa y no inicia la sesion", async () => {
    const { root } = await mountApp([epubBook(1)], { files: [{ bookId: uuid(1) }] });
    await db.epub_files.delete(uuid(1));
    await tap(openButton(root));
    await settle();
    expect(root.querySelector(".epub-reader")).toBeNull();
    expect(await db.meta.get(META_KEYS.activeSession)).toBeUndefined();
    expect(root.textContent).toContain("Falta el archivo .epub");
  });

  it("si el archivo falta cuando el lector lo pide, muestra el aviso y Salir sin guardar cierra la sesion", async () => {
    const { root, gate } = await mountApp([epubBook(1)], { files: [{ bookId: uuid(1) }] });
    // Se purga entre la preparacion y la lectura (Safari).
    const original = db.epub_files.get.bind(db.epub_files);
    let calls = 0;
    db.epub_files.get = ((key: string) => (calls++ === 0 ? original(key) : Promise.resolve(undefined))) as never;
    await tap(openButton(root));
    await settle();
    expect(root.querySelector('.epub-reader__notice[role="alert"]')?.textContent).toContain(
      "ya no está en el dispositivo",
    );
    await tap(byText(root, "button", "Salir sin guardar"));
    expect(root.querySelector(".epub-reader")).toBeNull();
    expect(await db.meta.get(META_KEYS.activeSession)).toBeUndefined();
    expect(gate.isBlocked()).toBe(false);
  });

  it("la posicion se guarda en cada cambio de pagina y el extracto cada 10 s", async () => {
    const { root, fake, env } = await mountApp([epubBook(1)], { files: [{ bookId: uuid(1) }] });
    await tap(openButton(root));
    await settle();
    await act(async () => fake.see({ cfi: "cfi-1", percentage: 10, text: "Primera pagina del libro leida con calma." }));
    await settle();
    expect(await storedProgress()).toMatchObject({ cfi: "cfi-1", percentage: 10 });

    env.advance(3_000);
    await act(async () => fake.see({ cfi: "cfi-2", percentage: 11, text: "Segunda pagina del libro leida con calma." }));
    await settle();
    // Sin esperar los 10 s ni un pagehide: si Android mata la app aqui, no se pierde la pagina.
    expect(await storedProgress()).toMatchObject({ cfi: "cfi-2", percentage: 11 });

    // Mismo lugar, texto nuevo: solo cambia el extracto, que espera su intervalo.
    env.advance(1_000);
    await act(async () => fake.see({ cfi: "cfi-2", percentage: 11, text: "Un parrafo que aparece sin pasar de pagina." }));
    await settle();
    expect((await storedProgress())?.excerpt).not.toContain("sin pasar de pagina");
    env.advance(PROGRESS_WRITE_MS);
    await settle(2_200); // el revisor de escritura corre cada 2 s
    expect((await storedProgress())?.excerpt).toBe(
      "Primera pagina del libro leida con calma. Segunda pagina del libro leida con calma. Un parrafo que aparece sin pasar de pagina.",
    );
  }, 15_000);

  it("pagehide escribe el extracto pendiente sin esperar los 10 s", async () => {
    const { root, fake, env } = await mountApp([epubBook(1)], { files: [{ bookId: uuid(1) }] });
    await tap(openButton(root));
    await settle();
    await act(async () => fake.see({ cfi: "cfi-1", percentage: 10, text: "" }));
    await settle();
    env.advance(1_000);
    await act(async () => fake.see({ cfi: "cfi-1", percentage: 10, text: "Texto nuevo en la misma pagina de la lectura." }));
    await settle();
    expect((await storedProgress())?.excerpt).toBe("");
    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
    });
    await settle();
    expect((await storedProgress())?.excerpt).toContain("Texto nuevo");
  });

  it("al ocultar la pestana (visibilitychange) tambien escribe lo pendiente", async () => {
    const { root, fake, env } = await mountApp([epubBook(1)], { files: [{ bookId: uuid(1) }] });
    await tap(openButton(root));
    await settle();
    await act(async () => fake.see({ cfi: "cfi-1", percentage: 10, text: "" }));
    await settle();
    env.advance(1_000);
    await act(async () => fake.see({ cfi: "cfi-1", percentage: 10, text: "Texto nuevo en la misma pagina de la lectura." }));
    await settle();
    expect((await storedProgress())?.excerpt).toBe("");
    const hidden = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    try {
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await settle();
    } finally {
      hidden.mockRestore();
    }
    expect((await storedProgress())?.excerpt).toContain("Texto nuevo");
  });

  it("nunca guarda un porcentaje si el lector no lo tiene (sin locations)", async () => {
    const { root, fake } = await mountApp([epubBook(1)], { files: [{ bookId: uuid(1) }] });
    await tap(openButton(root));
    await settle();
    await act(async () => fake.see({ cfi: "cfi-1", percentage: null, text: "Una pagina con texto suficiente." }));
    await settle();
    const saved = await storedProgress();
    expect(saved?.cfi).toBe("cfi-1");
    expect(saved?.percentage).toBeNull();
    expect(root.querySelector(".epub-reader__percent")).toBeNull();
  });

  it("al reabrir la app con la sesion en curso reanuda en el CFI guardado y conserva el extracto", async () => {
    const first = await mountApp([epubBook(1)], { files: [{ bookId: uuid(1) }] });
    await tap(openButton(first.root));
    await settle();
    await act(async () =>
      first.fake.see({ cfi: "cfi-7", percentage: 33, text: "Pagina que ya se habia leido antes de cerrar." }),
    );
    await settle();
    mounted?.unmount();

    const reopened = await mountApp([], { env: first.env });
    await settle();
    expect(reopened.root.querySelector(".epub-reader")).not.toBeNull();
    expect(reopened.fake.inputs[0]?.startCfi).toBe("cfi-7");
    await act(async () =>
      reopened.fake.see({ cfi: "cfi-8", percentage: 34, text: "Pagina nueva despues de reabrir la app." }),
    );
    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
    });
    await settle();
    expect((await storedProgress())?.excerpt).toBe(
      "Pagina que ya se habia leido antes de cerrar. Pagina nueva despues de reabrir la app.",
    );
  });

  it("al terminar el tiempo la hoja guarda sola el ultimo avance y el extracto, y borra los registros", async () => {
    const { root, fake, env, gate } = await mountApp([epubBook(1)], { files: [{ bookId: uuid(1) }] });
    await tap(openButton(root));
    await settle();
    await act(async () => fake.see({ cfi: "cfi-1", percentage: 10, text: "" }));
    await settle();
    env.advance(1_000);
    await act(async () =>
      fake.see({ cfi: "cfi-final", percentage: 22.5, text: "Texto leido durante la sesion de hoy." }),
    );
    env.advance(900_000);
    await settle(320);
    await settle(200);
    expect(fake.handle.destroy).toHaveBeenCalled();
    // EPUB: no hay Paso 1; guarda directo y ofrece la charla.
    expect(sheetTitle()).toBe("Lectura guardada");
    expect(sheet()?.querySelector("input")).toBeNull();
    expect((await db.sessions.toArray())[0]).toMatchObject({
      session_status: "COMPLETED",
      last_epub_cfi: "cfi-final",
      extracted_epub_excerpt: "Texto leido durante la sesion de hoy.",
    });
    expect(await db.books.get(uuid(1))).toMatchObject({ progress_percentage: 22.5, last_epub_cfi: "cfi-final" });
    expect(await storedProgress()).toBeNull();
    expect(await db.meta.get(META_KEYS.activeSession)).toBeUndefined();
    expect(gate.isBlocked()).toBe(false);
  });

  it("Por hoy no, volver al jardin deja el Dashboard sin registros de la sesion", async () => {
    const { root, fake, env } = await mountApp([epubBook(1)], { files: [{ bookId: uuid(1) }] });
    await tap(openButton(root));
    await settle();
    await act(async () => fake.see({ cfi: "cfi-1", percentage: 10, text: "" }));
    await settle();
    expect(await storedProgress()).not.toBeNull();
    env.advance(900_000);
    await settle(320);
    await settle(200);
    await tap(byText(sheet() as HTMLElement, "button", "Por hoy no, volver al jardín"));
    await settle();
    expect(sheet()).toBeNull();
    expect(root.querySelector(".dashboard")).not.toBeNull();
    expect(await db.meta.get(META_KEYS.activeSessionProgress)).toBeUndefined();
    expect(await db.meta.get(META_KEYS.activeSession)).toBeUndefined();
  });
});

describe("Terminé antes de tiempo en el lector", () => {
  async function startAndRead(percentage: number | null) {
    const ctx = await mountApp([epubBook(1)], { files: [{ bookId: uuid(1) }] });
    await tap(openButton(ctx.root));
    await settle();
    await act(async () => ctx.fake.see({ cfi: "cfi-1", percentage, text: "" }));
    ctx.env.advance(200_000); // 22 % del tiempo: bajo el 50 %
    return ctx;
  }

  it("con el 100 % exacto del libro vale aunque falte tiempo: se guarda y el girasol florece", async () => {
    const { root } = await startAndRead(100);
    await tap(byText(root, "button", "Terminé antes de tiempo"));
    await settle(200);
    expect(sheetTitle()).toBe("Tu girasol floreció");
    expect((await db.sessions.toArray())[0]).toMatchObject({ session_status: "EARLY_VALID" });
    expect(await db.books.get(uuid(1))).toMatchObject({ progress_percentage: 100, status: "BLOOMED" });
  });

  it("con 99,99 % no cuenta como terminado: pide confirmacion", async () => {
    const { root } = await startAndRead(99.99);
    await tap(byText(root, "button", "Terminé antes de tiempo"));
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("no se guarda ningún avance");
    expect(sheetTitle()).toBe("¿Terminar sin guardar?");
  });

  it("sin locations (porcentaje nulo) nunca se considera terminado", async () => {
    const { root } = await startAndRead(null);
    await tap(byText(root, "button", "Terminé antes de tiempo"));
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it("confirmar la cancelacion no guarda nada y vuelve al Dashboard", async () => {
    const { root } = await startAndRead(40);
    await tap(byText(root, "button", "Terminé antes de tiempo"));
    await tap(byText(document.body, "button", "Cancelar sesión"));
    expect(root.querySelector(".dashboard")).not.toBeNull();
    expect(await db.sessions.count()).toBe(0);
    expect(await db.meta.get(META_KEYS.activeSession)).toBeUndefined();
  });

  it("con el 50 % del tiempo vale sin importar el porcentaje del libro", async () => {
    const { root, env } = await startAndRead(5);
    env.advance(250_000); // 450 s de 900
    await tap(byText(root, "button", "Terminé antes de tiempo"));
    await settle(200);
    expect(sheetTitle()).toBe("Lectura guardada");
    expect(await db.books.get(uuid(1))).toMatchObject({ progress_percentage: 12 });
  });
});

describe("posicion de lectura aparte del avance validado", () => {
  const position = async (bookId: string) => (await db.meta.get(readerPositionKey(bookId)))?.value;

  it("cada pagina deja la posicion guardada, sin tocar el avance del libro", async () => {
    const { root, fake } = await mountApp([epubBook(1)], { files: [{ bookId: uuid(1) }] });
    await tap(openButton(root));
    await settle();
    await act(async () => fake.see({ cfi: "cfi-3", percentage: 40, text: "" }));
    await settle();
    expect(parseReaderPosition(await position(uuid(1)))).toBe("cfi-3");
    await act(async () => fake.see({ cfi: "cfi-4", percentage: 41, text: "" }));
    await settle();
    expect(parseReaderPosition(await position(uuid(1)))).toBe("cfi-4");
    expect(await db.books.get(uuid(1))).toMatchObject({ progress_percentage: 12, last_epub_cfi: null });
  });

  it("una sesion cancelada no pierde el lugar: la siguiente abre ahi y el avance sigue igual", async () => {
    const { root, fake, env } = await mountApp([epubBook(1)], { files: [{ bookId: uuid(1) }] });
    await tap(openButton(root));
    await settle();
    await act(async () => fake.see({ cfi: "cfi-9", percentage: 40, text: "" }));
    env.advance(200_000); // bajo el 50 %: se cancela
    await tap(byText(root, "button", "Terminé antes de tiempo"));
    await tap(byText(document.body, "button", "Cancelar sesión"));
    expect(root.querySelector(".dashboard")).not.toBeNull();
    expect(await db.books.get(uuid(1))).toMatchObject({ progress_percentage: 12, last_epub_cfi: null });

    await tap(openButton(root));
    await settle();
    expect(fake.inputs.at(-1)?.startCfi).toBe("cfi-9");
    expect(await db.books.get(uuid(1))).toMatchObject({ progress_percentage: 12, last_epub_cfi: null });
  });

  it("sin posicion guardada se usa el ultimo avance validado del libro", async () => {
    const { root, fake } = await mountApp([epubBook(1, { last_epub_cfi: "cfi-libro" })], {
      files: [{ bookId: uuid(1) }],
    });
    await tap(openButton(root));
    await settle();
    expect(fake.inputs[0]?.startCfi).toBe("cfi-libro");
  });

  it("la posicion guardada manda sobre el ultimo avance validado", async () => {
    await db.meta.put({ key: readerPositionKey(uuid(1)), value: JSON.stringify({ cfi: "cfi-pos", updatedAt: 1 }) });
    const { root, fake } = await mountApp([epubBook(1, { last_epub_cfi: "cfi-libro" })], {
      files: [{ bookId: uuid(1) }],
    });
    await tap(openButton(root));
    await settle();
    expect(fake.inputs[0]?.startCfi).toBe("cfi-pos");
  });

  it("la posicion de un libro no se usa en otro", async () => {
    await db.meta.put({ key: readerPositionKey(uuid(2)), value: JSON.stringify({ cfi: "cfi-otro", updatedAt: 1 }) });
    const { root, fake } = await mountApp([epubBook(1)], { files: [{ bookId: uuid(1) }] });
    await tap(openButton(root));
    await settle();
    expect(fake.inputs[0]?.startCfi).toBeNull();
  });

  it("una posicion danada se ignora", async () => {
    await db.meta.put({ key: readerPositionKey(uuid(1)), value: "{{{" });
    const { root, fake } = await mountApp([epubBook(1, { last_epub_cfi: "cfi-libro" })], {
      files: [{ bookId: uuid(1) }],
    });
    await tap(openButton(root));
    await settle();
    expect(fake.inputs[0]?.startCfi).toBe("cfi-libro");
  });
});

describe("gracia y tamano de letra en el lector", () => {
  it("al salir muestra el aviso en el encabezado; pasados 15 s se invalida y vuelve al Dashboard", async () => {
    const { root, env, gate } = await mountApp([epubBook(1)], { files: [{ bookId: uuid(1) }] });
    await tap(openButton(root));
    await settle();
    await act(async () => env.hide());
    expect(root.querySelector(".epub-reader__header .grace-banner")?.textContent).toContain("15 s");
    env.advance(15_001);
    await act(async () => env.show());
    await settle();
    expect(root.querySelector(".epub-reader")).toBeNull();
    expect(root.querySelector('[data-testid="session-invalidated"]')).not.toBeNull();
    expect(gate.isBlocked()).toBe(false);
    expect(await db.sessions.count()).toBe(1);
  });

  it("cambiar el tamano de letra se guarda en local y se reaplica al lector abierto", async () => {
    const { root, fake } = await mountApp([epubBook(1)], { files: [{ bookId: uuid(1) }] });
    await tap(openButton(root));
    await settle();
    await tap(root.querySelector('[aria-label="Letra más grande"]'));
    expect((await db.meta.get(META_KEYS.readerFontSize))?.value).toBe(20);
    expect(fake.handle.setTheme).toHaveBeenLastCalledWith(expect.objectContaining({ fontPx: 20, theme: "light" }));
    expect(fake.open).toHaveBeenCalledTimes(1); // no se reabre el libro
  });

  it("recuerda el tamano elegido en la proxima apertura", async () => {
    await db.meta.put({ key: META_KEYS.readerFontSize, value: 22 });
    const { root, fake } = await mountApp([epubBook(1)], { files: [{ bookId: uuid(1) }] });
    await tap(openButton(root));
    await settle();
    expect(fake.inputs[0]?.theme.fontPx).toBe(22);
    expect((root.querySelector('[aria-label="Letra más grande"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it("ignora un tamano guardado que no es valido", async () => {
    await db.meta.put({ key: META_KEYS.readerFontSize, value: 19 });
    const { root, fake } = await mountApp([epubBook(1)], { files: [{ bookId: uuid(1) }] });
    await tap(openButton(root));
    await settle();
    expect(fake.inputs[0]?.theme.fontPx).toBe(18);
  });
});
