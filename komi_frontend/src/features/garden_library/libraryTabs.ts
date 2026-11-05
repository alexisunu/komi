// Pestañas de Mi Jardin (SRS 13.2): Activos, Florecidos (100%) y En barbecho.

import type { LocalBook } from "../../data/local_db/types";

export type GardenTab = "active" | "bloomed" | "fallow";

export const GARDEN_TABS: ReadonlyArray<{ id: GardenTab; label: string }> = [
  { id: "active", label: "Activos" },
  { id: "bloomed", label: "Florecidos" },
  { id: "fallow", label: "En barbecho" },
];

/** Un libro con 100% es florecido aunque su estado aun no se haya actualizado. */
export function tabOf(book: LocalBook): GardenTab {
  if (book.status === "BLOOMED" || book.progress_percentage >= 100) return "bloomed";
  if (book.status === "FALLOW") return "fallow";
  return "active";
}

export function booksForTab(books: readonly LocalBook[], tab: GardenTab): LocalBook[] {
  return books.filter((book) => tabOf(book) === tab);
}

export function tabCounts(books: readonly LocalBook[]): Record<GardenTab, number> {
  const counts: Record<GardenTab, number> = { active: 0, bloomed: 0, fallow: 0 };
  for (const book of books) counts[tabOf(book)] += 1;
  return counts;
}

/** El archivo de un EPUB ya no esta (Safari lo purgo): se avisa para reimportarlo. */
export function reimportMessage(wholePercent: number): string {
  return `Reimportar archivo .epub para continuar en el ${wholePercent}%`;
}
