import { wholePercent } from "../../services/botanicCalculator";
import type { LocalBook } from "../../data/local_db/types";

/**
 * Libro del lienzo central. `books` llega ordenado del mas reciente al mas antiguo
 * (listBooks); se prefiere uno en curso y, si solo hay barbechos, el mas reciente de ellos.
 */
export function pickActiveBook(books: readonly LocalBook[]): LocalBook | null {
  const running = books.find((book) => book.status === "ACTIVE" || book.status === "GROWING");
  if (running) return running;
  return books.find((book) => book.status === "FALLOW") ?? null;
}

/** "Pág. 84 de 250 — 33%" para libros fisicos; "33%" para EPUB (SRS 6, zona 2). */
export function progressLabel(book: LocalBook): string {
  const percent = `${wholePercent(book.progress_percentage)}%`;
  if (book.format_type === "PHYSICAL" && book.total_pages !== null) {
    return `Pág. ${book.current_page} de ${book.total_pages} — ${percent}`;
  }
  return percent;
}
