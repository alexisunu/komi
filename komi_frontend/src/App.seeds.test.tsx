// Integracion de las Semillas del Dia con la app real: Dexie -> Mi Jardin -> cajon.

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type { KomiDatabase } from "./data/local_db/dexieDatabase";
import { createLocalProfileRepository } from "./data/local_db/localProfileRepository";
import { createApiClient } from "./data/network/apiClient";
import type { LocalBook } from "./data/local_db/types";
import { createTestDb, fakeClock, uuid } from "./test/db";
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

const settle = (ms = 60) => act(async () => new Promise((r) => setTimeout(r, ms)));
async function tap(el: Element | null | undefined) {
  if (!el) throw new Error("Elemento no encontrado");
  await act(async () => {
    (el as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 40));
  });
}
const navItem = (root: HTMLElement, label: string) =>
  [...root.querySelectorAll(".bottom-nav__item")].find((b) => b.textContent === label);

function book(over: Partial<LocalBook> = {}): LocalBook {
  return {
    id: uuid(1),
    title: "Kokoro",
    author: "Natsume Soseki",
    format_type: "PHYSICAL",
    sunflower_variant: "CLASSIC",
    status: "ACTIVE",
    total_pages: 264,
    current_page: 87,
    progress_percentage: 32.95,
    last_epub_cfi: null,
    created_at: "2026-11-01T00:00:00.000Z",
    completed_at: null,
    updated_at: "2026-11-01T00:00:00.000Z",
    pending_sync: 0,
    ...over,
  };
}

async function mountApp() {
  const profiles = createLocalProfileRepository(db, fakeClock(), undefined);
  await profiles.createProfile({
    profile_id: PROFILE,
    daily_goal_minutes: 15,
    preferred_moment: "MORNING",
    ai_reflection_style: "DEEP_ANALYSIS",
  });
  await profiles.updateProfile({ onboarding_synced: true });
  const fetchFn = vi.fn<typeof fetch>(() => Promise.reject(new TypeError("offline")));
  const api = createApiClient({ baseUrl: "https://api.komi.test", fetchFn, getProfileId: () => PROFILE });
  mounted = render(<App options={{ db, api }} />);
  await settle();
  return mounted.container;
}

describe("Semillas del Dia en la app", () => {
  it("la semilla guardada en Dexie aparece en el cajon del libro, sin red, con la fecha local de la sesion", async () => {
    await db.books.put(book());
    await db.sessions.add({
      id: uuid(50),
      book_id: uuid(1),
      planned_duration_sec: 900,
      actual_duration_sec: 900,
      started_at_local: "2026-11-05T23:50:00",
      session_status: "COMPLETED",
      current_page: 87,
      progress_percentage: null,
      last_epub_cfi: null,
      extracted_epub_excerpt: null,
      progress_delta: 1,
      granted_solar_bonus: false,
      pending_sync: 0,
      sync_rejection: null,
    });
    await db.reflections.put({
      chat_id: uuid(10),
      session_id: uuid(50),
      book_id: uuid(1),
      turn_count: 5,
      is_closed: true,
      key_takeaway: "Leer es sembrar con calma.",
      updated_at: "2026-11-06T04:55:00.000Z",
    });
    const root = await mountApp();
    await tap(navItem(root, "Mi Jardín"));
    await settle();

    const button = root.querySelector(".book-card__seeds");
    expect(button?.getAttribute("aria-label")).toBe("Semillas del Día de Kokoro: 1 semilla");
    await tap(button);
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("Leer es sembrar con calma.");
    expect(dialog?.textContent).toContain("5 de noviembre de 2026");
  });

  it("sin charlas cerradas el cajon abre vacio", async () => {
    await db.books.put(book());
    const root = await mountApp();
    await tap(navItem(root, "Mi Jardín"));
    await tap(root.querySelector(".book-card__seeds"));
    expect(document.querySelector(".seeds__empty")).not.toBeNull();
  });
});
