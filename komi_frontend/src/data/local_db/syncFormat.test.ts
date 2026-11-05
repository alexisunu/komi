import { describe, expect, it } from "vitest";
import { uuid } from "../../test/db";
import { buildSyncBatch, toSyncBook, toSyncSession } from "./syncFormat";
import type { LocalBook, LocalSession } from "./types";

const book: LocalBook = {
  id: uuid(1),
  title: "Kokoro",
  author: "Natsume Soseki",
  format_type: "PHYSICAL",
  sunflower_variant: "CLASSIC",
  status: "ACTIVE",
  total_pages: 264,
  current_page: 120,
  progress_percentage: 45.45,
  last_epub_cfi: null,
  created_at: "2026-11-05T10:00:00.000Z",
  completed_at: null,
  updated_at: "2026-11-05T11:00:00.000Z",
  pending_sync: 1,
};

const session: LocalSession = {
  id: uuid(50),
  book_id: uuid(1),
  planned_duration_sec: 900,
  actual_duration_sec: 900,
  started_at_local: "2026-11-05T23:50:00",
  session_status: "COMPLETED",
  current_page: 120,
  progress_percentage: null,
  last_epub_cfi: null,
  extracted_epub_excerpt: null,
  progress_delta: 3.5,
  granted_solar_bonus: true,
  pending_sync: 1,
  sync_rejection: null,
};

describe("toSyncBook (SyncBookSerializer)", () => {
  it("envia exactamente los campos que el servidor define", () => {
    expect(Object.keys(toSyncBook(book)).sort()).toEqual(
      [
        "id",
        "title",
        "author",
        "format_type",
        "sunflower_variant",
        "status",
        "total_pages",
        "current_page",
        "progress_percentage",
        "last_epub_cfi",
        "updated_at",
      ].sort(),
    );
  });

  it("no filtra campos locales", () => {
    const payload = toSyncBook(book) as unknown as Record<string, unknown>;
    expect(payload).not.toHaveProperty("pending_sync");
    expect(payload).not.toHaveProperty("created_at");
    expect(payload).not.toHaveProperty("completed_at");
  });

  it("el servidor solo acepta ACTIVE o FALLOW: BLOOMED y GROWING viajan como ACTIVE", () => {
    expect(toSyncBook({ ...book, status: "ACTIVE" }).status).toBe("ACTIVE");
    expect(toSyncBook({ ...book, status: "GROWING" }).status).toBe("ACTIVE");
    expect(toSyncBook({ ...book, status: "BLOOMED" }).status).toBe("ACTIVE");
    expect(toSyncBook({ ...book, status: "FALLOW" }).status).toBe("FALLOW");
  });

  it("conserva el instante UTC de updated_at y el progreso con 2 decimales", () => {
    const payload = toSyncBook(book);
    expect(payload.updated_at).toBe("2026-11-05T11:00:00.000Z");
    expect(JSON.stringify(payload)).toContain('"progress_percentage":45.45');
  });
});

describe("toSyncSession (SessionPayloadSerializer)", () => {
  it("fisico: pagina, sin campos de EPUB y sin los calculados localmente", () => {
    const payload = toSyncSession(session);
    expect(payload).toEqual({
      id: uuid(50),
      book_id: uuid(1),
      planned_duration_sec: 900,
      actual_duration_sec: 900,
      started_at_local: "2026-11-05T23:50:00",
      session_status: "COMPLETED",
      current_page: 120,
    });
    expect(payload).not.toHaveProperty("progress_delta");
    expect(payload).not.toHaveProperty("granted_solar_bonus");
    expect(payload).not.toHaveProperty("pending_sync");
  });

  it("EPUB: porcentaje, CFI y extracto; los null se omiten (el servidor no los admite)", () => {
    const payload = toSyncSession({
      ...session,
      current_page: null,
      progress_percentage: 33.33,
      last_epub_cfi: "epubcfi(/6/4)",
      extracted_epub_excerpt: "Fragmento",
    });
    expect(payload).toMatchObject({
      progress_percentage: 33.33,
      last_epub_cfi: "epubcfi(/6/4)",
      extracted_epub_excerpt: "Fragmento",
    });
    expect(payload).not.toHaveProperty("current_page");
  });

  it("una sesion ya sincronizada (extracto anulado) no lo vuelve a enviar", () => {
    const payload = toSyncSession({
      ...session,
      current_page: null,
      progress_percentage: 10,
      extracted_epub_excerpt: null,
    });
    expect(payload).not.toHaveProperty("extracted_epub_excerpt");
  });

  it("invalidada: sin datos de progreso", () => {
    const payload = toSyncSession({
      ...session,
      session_status: "INVALIDATED_GRACE_EXPIRED",
      current_page: null,
    });
    expect(Object.keys(payload).sort()).toEqual(
      [
        "id",
        "book_id",
        "planned_duration_sec",
        "actual_duration_sec",
        "started_at_local",
        "session_status",
      ].sort(),
    );
  });

  it("started_at_local viaja como hora de pared sin zona", () => {
    expect(toSyncSession(session).started_at_local).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
  });
});

describe("buildSyncBatch", () => {
  it("arma el lote con books y sessions", () => {
    const batch = buildSyncBatch([book], [session]);
    expect(Object.keys(batch).sort()).toEqual(["books", "sessions"]);
    expect(batch.books).toHaveLength(1);
    expect(batch.sessions).toHaveLength(1);
    expect(() => JSON.stringify(batch)).not.toThrow();
  });

  it("un lote vacio es valido", () => {
    expect(buildSyncBatch([], [])).toEqual({ books: [], sessions: [] });
  });
});
