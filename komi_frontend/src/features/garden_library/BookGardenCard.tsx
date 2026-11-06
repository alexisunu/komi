import { Archive, ArchiveRestore } from "lucide-react";
import { useRef } from "react";
import { ZenPrimaryButton } from "../../core/components/ZenPrimaryButton";
import { ICON_STROKE_WIDTH } from "../../core/theme/geometryTokens";
import type { LocalBook } from "../../data/local_db/types";
import { wholePercent } from "../../services/botanicCalculator";
import { canReadBook, progressLabel } from "../dashboard/activeBook";
import { SunflowerStageWidget } from "../dashboard/SunflowerStageWidget";
import "./BookGardenCard.css";
import { reimportMessage } from "./libraryTabs";

export interface BookGardenCardProps {
  book: LocalBook;
  /** Borde de acento: es el libro del Dashboard. */
  active?: boolean;
  /** Un EPUB sin archivo en el dispositivo (SRS 11.4, punto 3). */
  missingFile?: boolean;
  busy?: boolean;
  onArchive?: (book: LocalBook) => void;
  onRestore?: (book: LocalBook) => void;
  onReimport?: (book: LocalBook, file: File) => void;
  /** "Leer este libro": lo elige para el Dashboard. Solo en libros que se pueden leer. */
  onRead?: (book: LocalBook) => void;
}

const ICON_SIZE = 20;

/** Tarjeta de libro/girasol (SRS 10.3). El cajon de "Semillas del Dia" llega en el bloque 8. */
export function BookGardenCard({
  book,
  active = false,
  missingFile = false,
  busy = false,
  onArchive,
  onRestore,
  onReimport,
  onRead,
}: BookGardenCardProps) {
  const picker = useRef<HTMLInputElement>(null);
  const percent = wholePercent(book.progress_percentage);
  const bloomed = book.status === "BLOOMED" || book.progress_percentage >= 100;
  const fallow = book.status === "FALLOW" && !bloomed;

  return (
    <article className="book-card" data-active={active ? "true" : "false"}>
      <div className="book-card__row">
        <SunflowerStageWidget percentage={book.progress_percentage} fallow={fallow} size={48} mini />
        <div className="book-card__text">
          <h3 className="book-card__title">{book.title}</h3>
          <p className="book-card__author">{book.author}</p>
          <div className="book-card__badges">
            <span className="book-card__badge">{book.format_type === "EPUB" ? "EPUB" : "FÍSICO"}</span>
            <span className="book-card__badge book-card__badge--progress tabular" title={progressLabel(book)}>
              {percent}%
            </span>
          </div>
          {onRead && !active && canReadBook(book) && (
            <button
              type="button"
              className="book-card__read"
              aria-label={`Leer este libro: ${book.title}`}
              disabled={busy}
              onClick={() => onRead(book)}
            >
              Leer este libro
            </button>
          )}
        </div>
        {!bloomed && fallow && onRestore && (
          <button
            type="button"
            className="book-card__action"
            aria-label={`Volver a sembrar ${book.title}`}
            disabled={busy}
            onClick={() => onRestore(book)}
          >
            <ArchiveRestore size={ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" />
          </button>
        )}
        {!bloomed && !fallow && onArchive && (
          <button
            type="button"
            className="book-card__action"
            aria-label={`Poner en barbecho ${book.title}`}
            disabled={busy}
            onClick={() => onArchive(book)}
          >
            <Archive size={ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" />
          </button>
        )}
      </div>

      {missingFile && (
        <div className="book-card__notice" role="status">
          <p className="book-card__notice-text">{reimportMessage(percent)}</p>
          <input
            ref={picker}
            type="file"
            hidden
            accept=".epub,application/epub+zip"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) onReimport?.(book, file);
            }}
          />
          <ZenPrimaryButton variant="secondary" disabled={busy} onClick={() => picker.current?.click()}>
            Elegir archivo
          </ZenPrimaryButton>
        </div>
      )}
    </article>
  );
}
