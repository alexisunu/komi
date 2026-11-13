import { describe, expect, it } from "vitest";
import type { BookStatus, LocalBook } from "../../data/local_db/types";
import {
  canReadBook,
  dashboardAuthorLine,
  dashboardProgressLabel,
  pickActiveBook,
  progressLabel,
  resolveActiveBook,
} from "./activeBook";

function book(over: Partial<LocalBook> = {}): LocalBook {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    title: "Libro",
    author: "Autora",
    format_type: "PHYSICAL",
    sunflower_variant: "CLASSIC",
    status: "ACTIVE",
    total_pages: 250,
    current_page: 84,
    progress_percentage: 33.6,
    last_epub_cfi: null,
    created_at: "2026-11-01T00:00:00.000Z",
    completed_at: null,
    updated_at: "2026-11-01T00:00:00.000Z",
    pending_sync: 0,
    ...over,
  };
}

describe("pickActiveBook", () => {
  it("sin libros no hay lienzo", () => {
    expect(pickActiveBook([])).toBeNull();
  });

  it("elige el primero en curso (el mas reciente)", () => {
    const a = book({ id: "a", status: "GROWING" });
    const b = book({ id: "b", status: "ACTIVE" });
    expect(pickActiveBook([a, b])?.id).toBe("a");
  });

  it("ignora los florecidos y prefiere uno en curso sobre un barbecho mas reciente", () => {
    const fallow = book({ id: "f", status: "FALLOW" });
    const bloomed = book({ id: "x", status: "BLOOMED" });
    const running = book({ id: "r", status: "ACTIVE" });
    expect(pickActiveBook([bloomed, fallow, running])?.id).toBe("r");
    expect(pickActiveBook([bloomed, fallow])?.id).toBe("f");
    expect(pickActiveBook([bloomed])).toBeNull();
  });

  it.each(["ACTIVE", "GROWING"] as BookStatus[])("%s cuenta como en curso", (status) => {
    expect(pickActiveBook([book({ status })])).not.toBeNull();
  });
});

describe("etiquetas del Dashboard (mockup 07)", () => {
  it("autor con formato y progreso legible", () => {
    expect(dashboardAuthorLine(book({ format_type: "EPUB", total_pages: null }))).toBe(`${book().author} · EPUB`);
    expect(dashboardAuthorLine(book())).toBe(`${book().author} · Físico`);
    expect(dashboardProgressLabel(book({ format_type: "EPUB", total_pages: null }))).toBe("33 % leído");
    expect(dashboardProgressLabel(book())).toBe("Pág. 84 de 250 · 33 % leído");
    expect(dashboardProgressLabel(book({ total_pages: null }))).toBe("33 % leído");
  });
});

describe("progressLabel", () => {
  it("libro fisico: pagina, total y porcentaje truncado", () => {
    expect(progressLabel(book())).toBe("Pág. 84 de 250 — 33%");
    expect(progressLabel(book({ progress_percentage: 99.99 }))).toBe("Pág. 84 de 250 — 99%");
  });

  it("EPUB: solo el porcentaje", () => {
    expect(progressLabel(book({ format_type: "EPUB", total_pages: null }))).toBe("33%");
  });

  it("fisico sin total de paginas cae al porcentaje", () => {
    expect(progressLabel(book({ total_pages: null }))).toBe("33%");
  });
});

describe("canReadBook (precondicion de CU-03)", () => {
  it("acepta libros en curso por debajo del 100 %", () => {
    expect(canReadBook(book({ status: "ACTIVE" }))).toBe(true);
    expect(canReadBook(book({ status: "GROWING", progress_percentage: 99.99 }))).toBe(true);
  });

  it("rechaza barbecho, florecido y cualquier libro al 100 %", () => {
    expect(canReadBook(book({ status: "FALLOW" }))).toBe(false);
    expect(canReadBook(book({ status: "BLOOMED", progress_percentage: 100 }))).toBe(false);
    expect(canReadBook(book({ status: "ACTIVE", progress_percentage: 100 }))).toBe(false);
  });
});

describe("resolveActiveBook (Leer este libro)", () => {
  const a = book({ id: "a", title: "A" });
  const b = book({ id: "b", title: "B" });

  it("usa el libro elegido si sigue siendo valido", () => {
    expect(resolveActiveBook([a, b], "b")?.id).toBe("b");
  });

  it("sin eleccion o con un id desconocido, aplica la regla por defecto", () => {
    expect(resolveActiveBook([a, b], null)?.id).toBe("a");
    expect(resolveActiveBook([a, b], undefined)?.id).toBe("a");
    expect(resolveActiveBook([a, b], "no-existe")?.id).toBe("a");
  });

  it("si el elegido pasa a barbecho o florece, vuelve a la regla por defecto", () => {
    expect(resolveActiveBook([a, book({ id: "b", status: "FALLOW" })], "b")?.id).toBe("a");
    expect(
      resolveActiveBook([a, book({ id: "b", status: "BLOOMED", progress_percentage: 100 })], "b")?.id,
    ).toBe("a");
  });

  it("sin libros no hay lienzo", () => {
    expect(resolveActiveBook([], "b")).toBeNull();
  });
});
