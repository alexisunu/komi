// Vista previa de pantallas completas SOLO para desarrollo (verificacion visual en claro y oscuro con
// `screens.html?screen=garden&theme=dark`). Usa servicios falsos; no toca Dexie ni la red.
// No se lista en el build de produccion (lo verifica galleryExcluded.build.test.ts).

import { useEffect } from "react";
import { BottomNavZen } from "../core/components/BottomNavZen";
import { ThemeProvider } from "../core/theme/ThemeContext";
import type { LocalBook } from "../data/local_db/types";
import { EpubImportError } from "../services/epubService";
import type { GardenPlantService } from "../services/plantBookService";
import { DashboardScreen } from "../features/dashboard/DashboardScreen";
import { PhysicalTimerScreen } from "../features/focus_reader/PhysicalTimerScreen";
import type { FocusSnapshot } from "../services/focusVisibilityService";
import type { WakeLockService } from "../services/wakeLockService";
import { MyGardenScreen } from "../features/garden_library/MyGardenScreen";
import "../App.css";

export const SCREEN_PREVIEW_MARKER = "Vista previa de pantallas (solo desarrollo)";

export type PreviewScreen =
  | "garden"
  | "garden-empty"
  | "plant-epub"
  | "plant-epub-ready"
  | "plant-error"
  | "plant-preparing"
  | "plant-physical"
  | "dashboard"
  | "timer"
  | "timer-grace"
  | "timer-confirm";

function book(over: Partial<LocalBook> & Pick<LocalBook, "id" | "title" | "author">): LocalBook {
  return {
    format_type: "PHYSICAL",
    sunflower_variant: "CLASSIC",
    status: "ACTIVE",
    total_pages: 320,
    current_page: 0,
    progress_percentage: 0,
    last_epub_cfi: null,
    created_at: "2026-11-01T00:00:00.000Z",
    completed_at: null,
    updated_at: "2026-11-01T00:00:00.000Z",
    pending_sync: 0,
    ...over,
  };
}

const BOOKS: LocalBook[] = [
  book({ id: "1", title: "Kokoro", author: "Natsume Soseki", total_pages: 264, current_page: 87, progress_percentage: 32.95 }),
  book({ id: "2", title: "Ficciones", author: "Jorge Luis Borges", format_type: "EPUB", total_pages: null, progress_percentage: 12.4 }),
  book({ id: "3", title: "El nombre de la rosa", author: "Umberto Eco", progress_percentage: 71.2, total_pages: 512, current_page: 364 }),
  book({ id: "4", title: "Pedro Páramo", author: "Juan Rulfo", status: "FALLOW", progress_percentage: 45 }),
];

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function fakePlant(screen: PreviewScreen): GardenPlantService {
  return {
    prepareEpub: async () => {
      await wait(30);
      if (screen === "plant-error") throw new EpubImportError("drm");
      return { data: new ArrayBuffer(8), metadata: { title: "Ficciones", author: "Jorge Luis Borges" } };
    },
    plantEpub: (_prepared, _fields, onPreparing, onProgress) => {
      onPreparing?.();
      onProgress?.(0.42);
      return new Promise<LocalBook>(() => {});
    },
    plantPhysical: async () => BOOKS[0] as LocalBook,
    reimportEpub: async () => {},
  };
}

function setValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

const buttonByText = (text: string) =>
  [...document.querySelectorAll("button")].find((b) => b.textContent?.trim().startsWith(text));

/** Reproduce los toques que llevan a cada estado del modal. */
async function drive(screen: PreviewScreen) {
  if (screen === "timer-confirm") {
    await wait(50);
    buttonByText("Terminé antes de tiempo")?.click();
    return;
  }
  if (!screen.startsWith("plant")) return;
  await wait(50);
  buttonByText("Plantar libro")?.click();
  await wait(50);
  if (screen === "plant-physical") {
    buttonByText("Libro Físico")?.click();
    await wait(50);
    const fields = [...document.querySelectorAll<HTMLInputElement>("input:not([type=file])")];
    setValue(fields[0] as HTMLInputElement, "Cien años de soledad");
    setValue(fields[1] as HTMLInputElement, "Gabriel García Márquez");
    setValue(fields[2] as HTMLInputElement, "471");
    return;
  }
  if (screen === "plant-epub") return;
  const picker = document.querySelector<HTMLInputElement>("input[type=file]");
  if (!picker) return;
  Object.defineProperty(picker, "files", { value: [new File(["x"], "ficciones.epub")], configurable: true });
  picker.dispatchEvent(new Event("change", { bubbles: true }));
  await wait(150);
  if (screen === "plant-preparing") buttonByText("Plantar Semilla")?.click();
}

const FAKE_WAKE_LOCK = { acquire: async () => {}, release: async () => {} } as unknown as WakeLockService;

function snapshot(phase: "running" | "grace"): FocusSnapshot {
  return {
    phase,
    remainingMs: 754_200,
    elapsedMs: 145_800,
    plannedSec: 900,
    graceRemainingMs: phase === "grace" ? 9_100 : 0,
    actualSec: null,
    sessionId: "s",
    bookId: "1",
  };
}

function PreviewBody({ screen }: { screen: PreviewScreen }) {
  const kokoro = BOOKS[0] as LocalBook;
  if (screen === "dashboard") {
    return <DashboardScreen streakDays={4} book={kokoro} dailyGoalMinutes={15} canStart onStart={() => {}} />;
  }
  if (screen === "timer" || screen === "timer-grace" || screen === "timer-confirm") {
    return (
      <PhysicalTimerScreen
        book={kokoro}
        snapshot={snapshot(screen === "timer-grace" ? "grace" : "running")}
        wakeLock={FAKE_WAKE_LOCK}
        peekEarlyFinish={() => ({ actualSec: 145, belowHalf: true })}
        onAcceptEarly={() => {}}
        onCancel={() => {}}
      />
    );
  }
  return null;
}

export function ScreenPreview({ screen, theme }: { screen: PreviewScreen; theme: "light" | "dark" | null }) {
  useEffect(() => {
    void drive(screen);
  }, [screen]);

  return (
    <ThemeProvider storedMode={theme}>
      <div className="app-shell" data-preview={SCREEN_PREVIEW_MARKER}>
        <div className="app-shell__screen">
          {["dashboard", "timer", "timer-grace", "timer-confirm"].includes(screen) ? (
            <PreviewBody screen={screen} />
          ) : (
          <MyGardenScreen
            books={screen === "garden-empty" ? [] : BOOKS}
            missingFiles={new Set(screen === "garden" ? ["2"] : [])}
            activeBookId="1"
            plant={fakePlant(screen)}
            onPlanted={() => {}}
            onSetStatus={async () => {}}
            onReimport={async () => {}}
            onRead={async () => {}}
          />
          )}
        </div>
        {["timer", "timer-grace", "timer-confirm"].includes(screen) ? null : (
          <div data-block="nav">
            <BottomNavZen active={screen === "dashboard" ? "lectura" : "jardin"} onSelect={() => {}} />
          </div>
        )}
      </div>
    </ThemeProvider>
  );
}
