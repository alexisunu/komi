// Modal hibrido para plantar un libro (CU-02): "Importar .epub" (por defecto) o "Libro Físico".
// Cuatro bloques: encabezado de la hoja, pestañas, formulario y accion. Sin selector de variante:
// la elige `pickVariant` (hoy siempre CLASSIC, SRS 19).

import { FileUp } from "lucide-react";
import { useId, useRef, useState } from "react";
import { PreparationProgress } from "../../core/components/PreparationProgress";
import { ZenPrimaryButton } from "../../core/components/ZenPrimaryButton";
import { ZenSheet } from "../../core/components/ZenSheet";
import { ICON_STROKE_WIDTH } from "../../core/theme/geometryTokens";
import type { LocalBook } from "../../data/local_db/types";
import { EpubImportError } from "../../services/epubService";
import type { GardenPlantService, PreparedEpub } from "../../services/plantBookService";
import "./PlantBookModal.css";

export interface PlantBookModalProps {
  plant: GardenPlantService;
  onClose: () => void;
  onPlanted: (book: LocalBook) => void;
}

type Tab = "epub" | "physical";
type EpubPhase = "idle" | "inspecting" | "ready" | "planting";

function titleFromFileName(name: string): string {
  return name.replace(/\.epub$/i, "").replace(/[_-]+/g, " ").trim();
}

function messageOf(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "No se pudo plantar el libro. Intenta de nuevo.";
}

export function PlantBookModal({ plant, onClose, onPlanted }: PlantBookModalProps) {
  const ids = { title: useId(), author: useId(), pages: useId(), error: useId() };
  const picker = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<Tab>("epub");
  const [phase, setPhase] = useState<EpubPhase>("idle");
  const [prepared, setPrepared] = useState<PreparedEpub | null>(null);
  const [fileName, setFileName] = useState("");
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [pages, setPages] = useState("");
  const [saving, setSaving] = useState(false);
  const [fraction, setFraction] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offerPhysical, setOfferPhysical] = useState(false);

  const busy = phase === "inspecting" || phase === "planting" || saving;
  const dismissible = phase !== "planting" && !saving;

  function switchTab(next: Tab) {
    if (busy) return;
    setTab(next);
    setError(null);
    setOfferPhysical(false);
  }

  async function onFile(file: File) {
    setError(null);
    setOfferPhysical(false);
    setPrepared(null);
    setFileName(file.name);
    setPhase("inspecting");
    try {
      const next = await plant.prepareEpub(file);
      setPrepared(next);
      setTitle(next.metadata.title || titleFromFileName(file.name));
      setAuthor(next.metadata.author);
      setPhase("ready");
    } catch (failure) {
      // FA-2.2: archivo danado o con DRM -> aviso en terracota y la opcion de registrarlo como fisico.
      setTitle(titleFromFileName(file.name));
      setError(messageOf(failure));
      setOfferPhysical(failure instanceof EpubImportError);
      setPhase("idle");
    }
  }

  async function plantEpub() {
    if (!prepared) return;
    setError(null);
    setOfferPhysical(false);
    setFraction(null);
    try {
      const book = await plant.plantEpub(
        prepared,
        { title, author },
        () => setPhase("planting"),
        setFraction,
      );
      onPlanted(book);
    } catch (failure) {
      setError(messageOf(failure));
      setOfferPhysical(failure instanceof EpubImportError);
      setPhase("ready");
    }
  }

  async function plantPhysical() {
    setError(null);
    const total = pages.trim() === "" ? Number.NaN : Number(pages);
    if (!Number.isInteger(total) || total < 1) {
      setError("Ingresa el total de páginas como un número entero mayor a 0.");
      return;
    }
    setSaving(true);
    try {
      onPlanted(await plant.plantPhysical({ title, author, total_pages: total }));
    } catch (failure) {
      setError(messageOf(failure));
      setSaving(false);
    }
  }

  const epubReady = phase === "ready" && prepared !== null && title.trim() !== "" && author.trim() !== "";
  const physicalReady = title.trim() !== "" && author.trim() !== "" && pages.trim() !== "";

  return (
    <ZenSheet title="Plantar un libro" onClose={onClose} dismissible={dismissible}>
      <div className="plant__tabs" role="tablist" aria-label="Tipo de libro" data-block="tabs">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "epub"}
          className="plant__tab"
          onClick={() => switchTab("epub")}
        >
          Importar .epub
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "physical"}
          className="plant__tab"
          onClick={() => switchTab("physical")}
        >
          Libro Físico
        </button>
      </div>

      <div className="plant__form" data-block="form">
        {tab === "epub" && (
          <>
            <input
              ref={picker}
              type="file"
              hidden
              accept=".epub,application/epub+zip"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void onFile(file);
              }}
            />
            <ZenPrimaryButton variant="secondary" disabled={busy} onClick={() => picker.current?.click()}>
              <FileUp size={20} strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" />
              {fileName && phase !== "idle" ? fileName : "Elegir archivo .epub"}
            </ZenPrimaryButton>
            {phase === "inspecting" && (
              <p className="plant__status" role="status">
                Revisando tu libro
              </p>
            )}
            {phase === "planting" && <PreparationProgress fraction={fraction} />}
          </>
        )}

        {(tab === "physical" || phase === "ready" || phase === "planting") && (
          <>
            <div className="plant__field">
              <label htmlFor={ids.title}>Título</label>
              <input
                id={ids.title}
                value={title}
                maxLength={255}
                autoComplete="off"
                disabled={busy}
                aria-describedby={error ? ids.error : undefined}
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>
            <div className="plant__field">
              <label htmlFor={ids.author}>Autor</label>
              <input
                id={ids.author}
                value={author}
                maxLength={255}
                autoComplete="off"
                disabled={busy}
                onChange={(event) => setAuthor(event.target.value)}
              />
            </div>
            {tab === "physical" && (
              <div className="plant__field">
                <label htmlFor={ids.pages}>Total de páginas</label>
                <input
                  id={ids.pages}
                  value={pages}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="off"
                  disabled={busy}
                  className="tabular"
                  onChange={(event) => setPages(event.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
                />
              </div>
            )}
          </>
        )}

        {error && (
          <div className="plant__error" id={ids.error} role="alert">
            <p>{error}</p>
            {offerPhysical && tab === "epub" && (
              <ZenPrimaryButton variant="secondary" onClick={() => switchTab("physical")}>
                Registrarlo como libro físico
              </ZenPrimaryButton>
            )}
          </div>
        )}
      </div>

      <div className="plant__action" data-block="action">
        {tab === "epub" ? (
          <ZenPrimaryButton disabled={!epubReady || busy} onClick={() => void plantEpub()}>
            Plantar Semilla en Mi Jardín
          </ZenPrimaryButton>
        ) : (
          <ZenPrimaryButton disabled={!physicalReady || busy} onClick={() => void plantPhysical()}>
            Plantar Semilla en Mi Jardín
          </ZenPrimaryButton>
        )}
      </div>
    </ZenSheet>
  );
}
