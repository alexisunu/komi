// Vista previa de pantallas completas SOLO para desarrollo (verificacion visual en claro y oscuro con
// `screens.html?screen=garden&theme=dark`). Usa servicios falsos; no toca Dexie ni la red.
// No se lista en el build de produccion (lo verifica galleryExcluded.build.test.ts).

import { useEffect } from "react";
import { BottomNavZen } from "../core/components/BottomNavZen";
import { ThemeProvider } from "../core/theme/ThemeContext";
import type { LocalBook } from "../data/local_db/types";
import { EpubImportError } from "../services/epubService";
import type { PlantBookService } from "../services/plantBookService";
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
  | "plant-physical";

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

function fakePlant(screen: PreviewScreen): PlantBookService {
  return {
    prepareEpub: async () => {
      await wait(30);
      if (screen === "plant-error") throw new EpubImportError("drm");
      return { data: new ArrayBuffer(8), metadata: { title: "Ficciones", author: "Jorge Luis Borges" } };
    },
    plantEpub: (_prepared, _fields, onPreparing) => {
      onPreparing?.();
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

export function ScreenPreview({ screen, theme }: { screen: PreviewScreen; theme: "light" | "dark" | null }) {
  useEffect(() => {
    void drive(screen);
  }, [screen]);

  return (
    <ThemeProvider storedMode={theme}>
      <div className="app-shell" data-preview={SCREEN_PREVIEW_MARKER}>
        <div className="app-shell__screen">
          <MyGardenScreen
            books={screen === "garden-empty" ? [] : BOOKS}
            missingFiles={new Set(screen === "garden" ? ["2"] : [])}
            activeBookId="1"
            plant={fakePlant(screen)}
            onPlanted={() => {}}
            onSetStatus={async () => {}}
            onReimport={async () => {}}
          />
        </div>
        <div data-block="nav">
          <BottomNavZen active="jardin" onSelect={() => {}} />
        </div>
      </div>
    </ThemeProvider>
  );
}
