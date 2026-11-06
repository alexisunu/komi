// Mi Jardin (CU-02, SRS 13.2): pestañas Activos, Florecidos y En barbecho, la lista de tarjetas y el
// boton "Plantar libro". Tres bloques (con la navegacion son 4, RNF-01): encabezado con
// pestañas, lista y accion.

import { Plus } from "lucide-react";
import { useState } from "react";
import { ZenPrimaryButton } from "../../core/components/ZenPrimaryButton";
import { ICON_STROKE_WIDTH } from "../../core/theme/geometryTokens";
import type { LocalBook } from "../../data/local_db/types";
import type { SeedService } from "../../services/seedService";
import type { GardenPlantService } from "../../services/plantBookService";
import { BookGardenCard } from "./BookGardenCard";
import "./MyGardenScreen.css";
import { booksForTab, GARDEN_TABS, tabCounts, type GardenTab } from "./libraryTabs";
import { PlantBookModal } from "./PlantBookModal";
import { SeedsDrawer } from "./SeedsDrawer";
import { useSeeds } from "./useSeeds";

export interface MyGardenScreenProps {
  books: readonly LocalBook[];
  /** Ids de EPUB sin archivo en el dispositivo. */
  missingFiles: ReadonlySet<string>;
  /** Libro del Dashboard (borde de acento). */
  activeBookId: string | null;
  plant: GardenPlantService;
  onPlanted: (book: LocalBook) => void;
  onSetStatus: (book: LocalBook, status: "ACTIVE" | "FALLOW") => Promise<void>;
  onReimport: (book: LocalBook, file: File) => Promise<void>;
  /** "Leer este libro" (guarda el libro del Dashboard). */
  onRead: (book: LocalBook) => Promise<void>;
  /** Semillas del Dia (Dexie). Sin servicio, el cajon abre vacio. */
  seedSource?: Pick<SeedService, "loadByBook">;
}

const EMPTY_TEXT: Record<GardenTab, string> = {
  active: "Todavía no hay semillas plantadas. Planta tu primer libro.",
  bloomed: "Aquí florecerán los libros que termines.",
  fallow: "Los libros que pauses descansarán aquí, sin perder su avance.",
};

function errorText(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "No se pudo completar la acción. Intenta de nuevo.";
}

export function MyGardenScreen({
  books,
  missingFiles,
  activeBookId,
  plant,
  onPlanted,
  onSetStatus,
  onReimport,
  onRead,
  seedSource,
}: MyGardenScreenProps) {
  const seeds = useSeeds(seedSource);
  const [seedsBookId, setSeedsBookId] = useState<string | null>(null);
  const [tab, setTab] = useState<GardenTab>("active");
  const [planting, setPlanting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const counts = tabCounts(books);
  const visible = booksForTab(books, tab);
  const seedsBook = books.find((book) => book.id === seedsBookId) ?? null;

  async function run(book: LocalBook, action: () => Promise<void>) {
    setBusyId(book.id);
    setError(null);
    try {
      await action();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="garden">
      <header className="garden__header" data-block="header">
        <h1 className="garden__title">Mi Jardín</h1>
        <div className="garden__tabs" role="tablist" aria-label="Estado de los libros">
          {GARDEN_TABS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`garden-tab-${id}`}
              aria-selected={tab === id}
              aria-controls="garden-panel"
              className="garden__tab"
              onClick={() => setTab(id)}
            >
              {label}
              <span className="garden__count tabular">{counts[id]}</span>
            </button>
          ))}
        </div>
      </header>

      <section
        className="garden__list"
        id="garden-panel"
        role="tabpanel"
        aria-labelledby={`garden-tab-${tab}`}
        data-block="list"
      >
        {error && (
          <p className="garden__error" role="alert">
            {error}
          </p>
        )}
        {visible.length === 0 ? (
          <p className="garden__empty">{EMPTY_TEXT[tab]}</p>
        ) : (
          visible.map((book) => (
            <BookGardenCard
              key={book.id}
              book={book}
              active={book.id === activeBookId}
              missingFile={missingFiles.has(book.id)}
              busy={busyId === book.id}
              onArchive={(target) => void run(target, () => onSetStatus(target, "FALLOW"))}
              onRestore={(target) => void run(target, () => onSetStatus(target, "ACTIVE"))}
              onReimport={(target, file) => void run(target, () => onReimport(target, file))}
              onRead={(target) => void run(target, () => onRead(target))}
              seeds={seeds.get(book.id) ?? []}
              onOpenSeeds={(target) => setSeedsBookId(target.id)}
            />
          ))
        )}
      </section>

      <footer className="garden__footer" data-block="action">
        <ZenPrimaryButton onClick={() => setPlanting(true)}>
          <Plus size={20} strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" />
          Plantar libro
        </ZenPrimaryButton>
      </footer>

      {seedsBook && (
        <SeedsDrawer book={seedsBook} seeds={seeds.get(seedsBook.id) ?? []} onClose={() => setSeedsBookId(null)} />
      )}

      {planting && (
        <PlantBookModal
          plant={plant}
          onClose={() => setPlanting(false)}
          onPlanted={(book) => {
            setPlanting(false);
            setTab("active");
            onPlanted(book);
          }}
        />
      )}
    </div>
  );
}
