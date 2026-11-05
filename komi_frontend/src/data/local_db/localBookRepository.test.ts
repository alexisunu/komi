import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, fakeClock, uuid, type FakeClock } from "../../test/db";
import type { KomiDatabase } from "./dexieDatabase";
import { BookNotFoundError, InvalidBookError } from "./errors";
import { createLocalBookRepository, type LocalBookRepository } from "./localBookRepository";

let db: KomiDatabase;
let clock: FakeClock;
let books: LocalBookRepository;

beforeEach(() => {
  db = createTestDb();
  clock = fakeClock();
  books = createLocalBookRepository(db, clock);
});
afterEach(() => db.close());

const physical = { title: "Kokoro", author: "Natsume Soseki", format_type: "PHYSICAL" as const, total_pages: 264 };
const epub = { title: "Snow Country", author: "Kawabata", format_type: "EPUB" as const };

describe("createBook", () => {
  it("crea un libro fisico en semilla, pendiente de sync, con el UUID del cliente", async () => {
    const book = await books.createBook(physical);
    expect(book).toMatchObject({
      title: "Kokoro",
      author: "Natsume Soseki",
      format_type: "PHYSICAL",
      sunflower_variant: "CLASSIC",
      status: "ACTIVE",
      total_pages: 264,
      current_page: 0,
      progress_percentage: 0,
      last_epub_cfi: null,
      completed_at: null,
      pending_sync: 1,
      created_at: "2026-11-05T10:00:00.000Z",
      updated_at: "2026-11-05T10:00:00.000Z",
    });
    expect(book.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await books.getBook(book.id)).toEqual(book);
  });

  it("un EPUB no guarda total de paginas aunque se lo pasen", async () => {
    const book = await books.createBook({ ...epub, total_pages: 300 });
    expect(book.total_pages).toBeNull();
  });

  it("limpia espacios y rechaza textos vacios o demasiado largos", async () => {
    expect((await books.createBook({ ...physical, title: "  Kokoro  " })).title).toBe("Kokoro");
    await expect(books.createBook({ ...physical, title: "   " })).rejects.toBeInstanceOf(InvalidBookError);
    await expect(books.createBook({ ...physical, author: "x".repeat(256) })).rejects.toBeInstanceOf(
      InvalidBookError,
    );
  });

  it.each([undefined, 0, -3, 1.5, 100_001])("un fisico rechaza total_pages=%s", async (pages) => {
    await expect(books.createBook({ ...physical, total_pages: pages })).rejects.toBeInstanceOf(
      InvalidBookError,
    );
  });

  it("acepta los limites 1 y 100000 paginas", async () => {
    expect((await books.createBook({ ...physical, total_pages: 1 })).total_pages).toBe(1);
    expect((await books.createBook({ ...physical, total_pages: 100_000 })).total_pages).toBe(100_000);
  });

  it("es idempotente por id: repetir no sobrescribe ni duplica", async () => {
    const first = await books.createBook({ ...physical, id: uuid(7) });
    clock.advance(60_000);
    const again = await books.createBook({ ...physical, id: uuid(7), title: "Otro titulo" });
    expect(again).toEqual(first);
    expect(await db.books.count()).toBe(1);
  });

  it("rechaza un id que no es UUID", async () => {
    await expect(books.createBook({ ...physical, id: "abc" })).rejects.toBeInstanceOf(InvalidBookError);
  });
});

describe("updateBook: updated_at solo cambia si algo cambio de verdad", () => {
  it("repetir la misma peticion no toca updated_at ni la marca de pendiente", async () => {
    const book = await books.createBook(physical);
    await books.markBooksSynced([{ id: book.id, updated_at: book.updated_at }]);
    clock.advance(3_600_000);

    const same = await books.updateBook(book.id, { title: "Kokoro", author: "Natsume Soseki" });
    expect(same.updated_at).toBe("2026-11-05T10:00:00.000Z");
    expect(same.pending_sync).toBe(0);
    expect((await books.getBook(book.id))?.updated_at).toBe("2026-11-05T10:00:00.000Z");

    // Texto igual salvo espacios: tampoco es un cambio.
    const spaced = await books.updateBook(book.id, { title: "  Kokoro " });
    expect(spaced.updated_at).toBe("2026-11-05T10:00:00.000Z");
  });

  it("un cambio real actualiza updated_at y vuelve a marcar pendiente", async () => {
    const book = await books.createBook(physical);
    await books.markBooksSynced([{ id: book.id, updated_at: book.updated_at }]);
    clock.advance(3_600_000);

    const changed = await books.updateBook(book.id, { title: "Kokoro (edicion 2)" });
    expect(changed.title).toBe("Kokoro (edicion 2)");
    expect(changed.updated_at).toBe("2026-11-05T11:00:00.000Z");
    expect(changed.pending_sync).toBe(1);
  });

  it("archivar en barbecho y devolver a activo", async () => {
    const book = await books.createBook(physical);
    clock.advance(1000);
    expect((await books.updateBook(book.id, { status: "FALLOW" })).status).toBe("FALLOW");
    clock.advance(1000);
    expect((await books.updateBook(book.id, { status: "ACTIVE" })).status).toBe("ACTIVE");
  });

  it("ACTIVE sobre un libro al 100% lo devuelve a BLOOMED, no a ACTIVE", async () => {
    const book = await books.createBook(physical);
    await db.books.put({ ...book, progress_percentage: 100, current_page: 264, status: "FALLOW" });
    expect((await books.updateBook(book.id, { status: "ACTIVE" })).status).toBe("BLOOMED");
  });

  it("falla con BookNotFoundError si el libro no existe", async () => {
    await expect(books.updateBook(uuid(99), { title: "X" })).rejects.toBeInstanceOf(BookNotFoundError);
  });
});

describe("consultas", () => {
  it("listBooks filtra por estado y ordena por updated_at descendente", async () => {
    const a = await books.createBook({ ...physical, title: "A" });
    clock.advance(1000);
    const b = await books.createBook({ ...physical, title: "B" });
    clock.advance(1000);
    const c = await books.createBook({ ...epub, title: "C" });
    await books.updateBook(a.id, { status: "FALLOW" });

    expect((await books.listBooks()).map((x) => x.title)).toEqual(["A", "C", "B"]);
    expect((await books.listBooks({ statuses: ["ACTIVE", "GROWING"] })).map((x) => x.id)).toEqual([c.id, b.id]);
    expect((await books.listBooks({ statuses: ["FALLOW"] })).map((x) => x.id)).toEqual([a.id]);
    expect(await books.listBooks({ statuses: ["BLOOMED"] })).toEqual([]);
  });

  it("getBook devuelve undefined si no existe", async () => {
    expect(await books.getBook(uuid(404))).toBeUndefined();
  });
});

describe("cola de sincronizacion de libros", () => {
  it("lista solo los pendientes", async () => {
    const a = await books.createBook({ ...physical, title: "A" });
    const b = await books.createBook({ ...physical, title: "B" });
    await books.markBooksSynced([{ id: a.id, updated_at: a.updated_at }]);
    expect((await books.listPendingBooks()).map((x) => x.id)).toEqual([b.id]);
  });

  it("no limpia la marca de un libro que cambio mientras se enviaba el lote", async () => {
    const book = await books.createBook(physical);
    const sent = { id: book.id, updated_at: book.updated_at };
    clock.advance(1000);
    await books.updateBook(book.id, { title: "Cambio durante el envio" });

    await books.markBooksSynced([sent]);
    const after = await books.getBook(book.id);
    expect(after?.pending_sync).toBe(1);
    expect(after?.title).toBe("Cambio durante el envio");
  });

  it("marcar sincronizado dos veces no cambia nada ni toca updated_at", async () => {
    const book = await books.createBook(physical);
    const sent = [{ id: book.id, updated_at: book.updated_at }];
    await books.markBooksSynced(sent);
    const once = await books.getBook(book.id);
    await books.markBooksSynced(sent);
    expect(await books.getBook(book.id)).toEqual(once);
    expect(once?.pending_sync).toBe(0);
    expect(once?.updated_at).toBe(book.updated_at);
  });

  it("ignora ids desconocidos", async () => {
    await expect(books.markBooksSynced([{ id: uuid(404), updated_at: "x" }])).resolves.toBeUndefined();
  });
});
