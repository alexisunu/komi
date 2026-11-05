import { describe, expect, it } from "vitest";
import type { LocalBook } from "../../data/local_db/types";
import { booksForTab, GARDEN_TABS, reimportMessage, tabCounts, tabOf } from "./libraryTabs";

function book(over: Partial<LocalBook>): LocalBook {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    title: "T",
    author: "A",
    format_type: "PHYSICAL",
    sunflower_variant: "CLASSIC",
    status: "ACTIVE",
    total_pages: 100,
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

describe("pestañas de Mi Jardin", () => {
  it("se llaman Activos, Florecidos y En barbecho", () => {
    expect(GARDEN_TABS.map((t) => t.label)).toEqual(["Activos", "Florecidos", "En barbecho"]);
  });

  it("ACTIVE y GROWING son activos; FALLOW, barbecho; BLOOMED, florecido", () => {
    expect(tabOf(book({ status: "ACTIVE" }))).toBe("active");
    expect(tabOf(book({ status: "GROWING" }))).toBe("active");
    expect(tabOf(book({ status: "FALLOW" }))).toBe("fallow");
    expect(tabOf(book({ status: "BLOOMED" }))).toBe("bloomed");
  });

  it("un libro al 100% es florecido aunque su estado no se haya actualizado, incluso en barbecho", () => {
    expect(tabOf(book({ status: "ACTIVE", progress_percentage: 100 }))).toBe("bloomed");
    expect(tabOf(book({ status: "FALLOW", progress_percentage: 100 }))).toBe("bloomed");
  });

  it("99,99% todavia no es florecido", () => {
    expect(tabOf(book({ progress_percentage: 99.99 }))).toBe("active");
  });

  it("filtra y cuenta", () => {
    const all = [
      book({ id: "a" }),
      book({ id: "b", status: "FALLOW" }),
      book({ id: "c", status: "BLOOMED", progress_percentage: 100 }),
      book({ id: "d", status: "GROWING" }),
    ];
    expect(booksForTab(all, "active").map((b) => b.id)).toEqual(["a", "d"]);
    expect(booksForTab(all, "fallow").map((b) => b.id)).toEqual(["b"]);
    expect(tabCounts(all)).toEqual({ active: 2, bloomed: 1, fallow: 1 });
    expect(tabCounts([])).toEqual({ active: 0, bloomed: 0, fallow: 0 });
  });

  it("el aviso de reimportar usa el porcentaje", () => {
    expect(reimportMessage(33)).toBe("Reimportar archivo .epub para continuar en el 33%");
  });
});
