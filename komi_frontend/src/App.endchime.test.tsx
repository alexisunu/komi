// Integracion del sonido de fin de tiempo (v2): el audio se desbloquea dentro del toque de
// "Comenzar lectura", suena solo al llegar a cero en el temporizador de un libro fisico y la hoja de
// cierre avisa por escrito. Dexie y la app son reales; el reloj, wakeLock y el sonido son falsos.

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type { KomiDatabase } from "./data/local_db/dexieDatabase";
import { createLocalProfileRepository } from "./data/local_db/localProfileRepository";
import type { LocalBook } from "./data/local_db/types";
import { createApiClient } from "./data/network/apiClient";
import { createReloadGate } from "./pwa/reloadGate";
import type { EndChimeService } from "./services/endChime";
import type { WakeLockService } from "./services/wakeLockService";
import { createTestDb, fakeClock, uuid } from "./test/db";
import { createFocusEnv } from "./test/focusEnv";
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
const startButton = (root: HTMLElement) => byText(root, "button", "Comenzar lectura") as HTMLButtonElement;

async function mountApp(books: LocalBook[]) {
  const env = createFocusEnv();
  const profiles = createLocalProfileRepository(db, fakeClock(), undefined);
  await profiles.createProfile({
    profile_id: PROFILE,
    daily_goal_minutes: 15,
    preferred_moment: "MORNING",
    ai_reflection_style: "DEEP_ANALYSIS",
  });
  await profiles.updateProfile({ onboarding_synced: true });
  for (const b of books) await db.books.put(b);
  const fetchFn = vi.fn<typeof fetch>(async () => new Response("{}", { status: 500 }));
  const api = createApiClient({ baseUrl: "https://api.komi.test", fetchFn, getProfileId: () => PROFILE });
  const wakeLock = { acquire: vi.fn(async () => {}), release: vi.fn(async () => {}) };
  const chime = { unlock: vi.fn(), play: vi.fn(() => true) };
  mounted = render(
    <App
      options={{
        db,
        api,
        focusEnv: { now: env.now, doc: env.doc, win: env.win },
        gate: createReloadGate(vi.fn()),
        wakeLock: wakeLock as unknown as WakeLockService,
        endChime: chime as unknown as EndChimeService,
      }}
    />,
  );
  await settle();
  return { root: mounted.container, env, chime };
}

describe("sonido de fin de tiempo (libro fisico, temporizador)", () => {
  it("se desbloquea dentro del toque de Comenzar lectura, de forma sincrona", async () => {
    const { root, chime } = await mountApp([book()]);
    const button = startButton(root);
    await act(async () => {
      button.click();
      // Nada se ha esperado todavia: el desbloqueo ocurre dentro del gesto, antes de cualquier await.
      expect(chime.unlock).toHaveBeenCalledTimes(1);
      await new Promise((r) => setTimeout(r, 40));
    });
    expect(chime.play).not.toHaveBeenCalled();
  });

  it("al llegar a cero suena una vez y la hoja de cierre dice que el tiempo termino", async () => {
    const { root, env, chime } = await mountApp([book()]);
    await tap(startButton(root));
    env.advance(900_000 + 5);
    await settle(320);
    await settle();
    expect(chime.play).toHaveBeenCalledTimes(1);
    expect(sheet()?.textContent).toContain("El tiempo terminó.");
  });

  it("Terminar sesion antes de cero no suena ni dice que el tiempo termino", async () => {
    const { root, env, chime } = await mountApp([book()]);
    await tap(startButton(root));
    env.advance(600_000);
    await tap(byText(root, "button", "Terminar sesión"));
    await settle();
    expect(sheet()).not.toBeNull();
    expect(chime.play).not.toHaveBeenCalled();
    expect(sheet()?.textContent).not.toContain("El tiempo terminó");
  });

  it("el modo libre no desbloquea, no suena y no avisa", async () => {
    const { root, env, chime } = await mountApp([book()]);
    await tap(byText(root, "button", "Libre"));
    await tap(startButton(root));
    expect(chime.unlock).not.toHaveBeenCalled();
    env.advance(6 * 60_000);
    await tap(byText(root, "button", "Terminar sesión"));
    await settle();
    expect(chime.play).not.toHaveBeenCalled();
    expect(sheet()?.textContent ?? "").not.toContain("El tiempo terminó");
  });

  it("aunque el audio no suene (play devuelve false), el aviso visual aparece igual", async () => {
    const { root, env, chime } = await mountApp([book()]);
    chime.play.mockReturnValue(false);
    await tap(startButton(root));
    env.advance(900_000 + 5);
    await settle(320);
    await settle();
    expect(sheet()?.textContent).toContain("El tiempo terminó.");
  });
});
