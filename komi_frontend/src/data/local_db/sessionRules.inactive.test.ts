// `acceptInactiveBook` (bloque 6): una lectura valida sobre un libro en barbecho o florecido se
// guarda, como en /profile/sync/. Sin la opcion se conserva el 409 de /sessions/complete/.

import { describe, expect, it } from "vitest";
import { SessionConflictError } from "./errors";
import { evaluateSession, type CompleteSessionInput } from "./sessionRules";
import type { LocalBook } from "./types";
import { uuid } from "../../test/db";

function book(over: Partial<LocalBook> = {}): LocalBook {
  return {
    id: uuid(1),
    title: "Libro",
    author: "Autora",
    format_type: "PHYSICAL",
    sunflower_variant: "CLASSIC",
    status: "ACTIVE",
    total_pages: 300,
    current_page: 30,
    progress_percentage: 10,
    last_epub_cfi: null,
    created_at: "2026-11-01T00:00:00.000Z",
    completed_at: null,
    updated_at: "2026-11-01T00:00:00.000Z",
    pending_sync: 0,
    ...over,
  };
}

function input(over: Partial<CompleteSessionInput> = {}): CompleteSessionInput {
  return {
    id: uuid(500),
    book_id: uuid(1),
    planned_duration_sec: 900,
    actual_duration_sec: 900,
    started_at_local: "2026-11-06T11:30:00",
    session_status: "COMPLETED",
    current_page: 60,
    ...over,
  };
}

describe("evaluateSession con libros inactivos", () => {
  it("por defecto un libro en barbecho o florecido sigue rechazando (409)", () => {
    expect(() => evaluateSession(book({ status: "FALLOW" }), input())).toThrow(SessionConflictError);
    expect(() => evaluateSession(book({ status: "BLOOMED", progress_percentage: 100 }), input())).toThrow(
      SessionConflictError,
    );
  });

  it("con la opcion, el barbecho acepta y conserva su avance con MAX", () => {
    const outcome = evaluateSession(book({ status: "FALLOW" }), input(), { acceptInactiveBook: true });
    expect(outcome).toMatchObject({ valid: true, newProgressHundredths: 2000, newPage: 60, justBloomed: false });
  });

  it("con la opcion, el barbecho que llega al 100 % florece por primera vez", () => {
    const outcome = evaluateSession(book({ status: "FALLOW" }), input({ current_page: 300 }), {
      acceptInactiveBook: true,
    });
    expect(outcome).toMatchObject({ newProgressHundredths: 10_000, justBloomed: true });
  });

  it("con la opcion, el florecido no cambia: ni progreso, ni pagina, ni florece otra vez", () => {
    const outcome = evaluateSession(
      book({ status: "BLOOMED", progress_percentage: 100, current_page: 300 }),
      input({ current_page: 120 }),
      { acceptInactiveBook: true },
    );
    expect(outcome).toMatchObject({
      valid: true,
      newProgressHundredths: 10_000,
      newPage: 300,
      deltaHundredths: 0,
      justBloomed: false,
      updateCfi: false,
      reportedPage: 120,
    });
  });

  it("con la opcion, un florecido con pagina atrasada no la adelanta (no hay cambio que escribir)", () => {
    const outcome = evaluateSession(
      book({ status: "BLOOMED", progress_percentage: 100, current_page: 200 }),
      input({ current_page: 250 }),
      { acceptInactiveBook: true },
    );
    expect(outcome.newPage).toBe(200);
  });

  it("con la opcion, un EPUB florecido no mueve el CFI", () => {
    const epub = book({
      format_type: "EPUB",
      total_pages: null,
      status: "BLOOMED",
      progress_percentage: 100,
      last_epub_cfi: "cfi-fin",
    });
    const epubInput = { ...input(), current_page: undefined, progress_percentage: 100, last_epub_cfi: "cfi-otro" };
    const outcome = evaluateSession(epub, epubInput, { acceptInactiveBook: true });
    expect(outcome).toMatchObject({ valid: true, updateCfi: false, justBloomed: false });
  });

  it("la opcion no relaja la regla del 50 %", () => {
    expect(() =>
      evaluateSession(book({ status: "FALLOW" }), input({ actual_duration_sec: 100 }), { acceptInactiveBook: true }),
    ).toThrow(/50%/);
  });
});
