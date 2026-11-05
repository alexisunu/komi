import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StorageQuotaError } from "../data/local_db/errors";
import type { KomiDatabase } from "../data/local_db/dexieDatabase";
import { createLocalBookRepository } from "../data/local_db/localBookRepository";
import { createLocalEpubRepository } from "../data/local_db/localEpubRepository";
import { buildEpub } from "../test/epubFixture";
import { createTestDb, fakeClock } from "../test/db";
import { createEpubService, EpubImportError } from "./epubService";
import { createPlantBookService } from "./plantBookService";

let db: KomiDatabase;
const epub = createEpubService({ openTimeoutMs: 400 });

beforeEach(() => {
  db = createTestDb();
});
afterEach(() => db.close());

function setup(pick: () => "CLASSIC" | "SOLAR" | "AUTUMN" = () => "CLASSIC") {
  const clock = fakeClock();
  const epubFiles = createLocalEpubRepository(db, clock);
  const books = createLocalBookRepository(db, clock);
  return { epubFiles, books, service: createPlantBookService({ epub, epubFiles, books, pickVariant: pick }) };
}

function file(data: ArrayBuffer) {
  return { size: data.byteLength, arrayBuffer: async () => data };
}

describe("plantar un EPUB", () => {
  it("valida, prepara las locations y guarda libro, archivo y locations juntos", async () => {
    const { service, epubFiles } = setup();
    const prepared = await service.prepareEpub(file(buildEpub({ title: "Ficciones", creator: "Borges" })));
    expect(prepared.metadata).toEqual({ title: "Ficciones", author: "Borges" });

    const preparing = vi.fn();
    const book = await service.plantEpub(prepared, { title: "Ficciones", author: "Borges" }, preparing);
    expect(preparing).toHaveBeenCalledTimes(1);
    expect(book).toMatchObject({ format_type: "EPUB", status: "ACTIVE", progress_percentage: 0, pending_sync: 1 });
    expect(await epubFiles.hasFile(book.id)).toBe(true);
    const locations = JSON.parse((await epubFiles.getLocations(book.id)) ?? "null") as string[];
    expect(locations.length).toBeGreaterThan(1);
  });

  it("el lector puede corregir titulo y autor antes de plantar", async () => {
    const { service } = setup();
    const prepared = await service.prepareEpub(file(buildEpub({ creator: null })));
    const book = await service.plantEpub(prepared, { title: "  Mi titulo ", author: "Alguien" });
    expect(book).toMatchObject({ title: "Mi titulo", author: "Alguien" });
  });

  it("la variante sale de pickVariant (hoy CLASSIC; inyectable)", async () => {
    const pick = vi.fn(() => "AUTUMN" as const);
    const { service } = setup(pick);
    const prepared = await service.prepareEpub(file(buildEpub()));
    expect((await service.plantEpub(prepared, { title: "A", author: "B" })).sunflower_variant).toBe("AUTUMN");
    const physical = await service.plantPhysical({ title: "C", author: "D", total_pages: 100 });
    expect(physical.sunflower_variant).toBe("AUTUMN");
    expect(pick).toHaveBeenCalledTimes(2);
  });

  it("por defecto siempre es CLASSIC", async () => {
    const clock = fakeClock();
    const epubFiles = createLocalEpubRepository(db, clock);
    const books = createLocalBookRepository(db, clock);
    const service = createPlantBookService({ epub, epubFiles, books });
    expect((await service.plantPhysical({ title: "A", author: "B", total_pages: 10 })).sunflower_variant).toBe("CLASSIC");
  });

  it("un archivo con DRM se rechaza al preparar y no guarda nada", async () => {
    const { service } = setup();
    await expect(service.prepareEpub(file(buildEpub({ rightsXml: "<rights/>" })))).rejects.toMatchObject({
      problem: "drm",
    });
    expect(await db.books.count()).toBe(0);
  });

  it("un archivo que el navegador no puede leer es unreadable", async () => {
    const { service } = setup();
    const broken = { size: 1, arrayBuffer: () => Promise.reject(new Error("permiso")) };
    await expect(service.prepareEpub(broken)).rejects.toBeInstanceOf(EpubImportError);
  });

  it("con la cuota llena no queda ni libro ni archivo", async () => {
    const { service } = setup();
    db.epub_files.hook("creating", () => {
      throw new DOMException("sin espacio", "QuotaExceededError");
    });
    const prepared = await service.prepareEpub(file(buildEpub()));
    await expect(service.plantEpub(prepared, { title: "A", author: "B" })).rejects.toBeInstanceOf(StorageQuotaError);
    expect(await db.books.count()).toBe(0);
    expect(await db.epub_files.count()).toBe(0);
  });

  it("si las locations fallan, no se crea el libro", async () => {
    const clock = fakeClock();
    const epubFiles = createLocalEpubRepository(db, clock);
    const books = createLocalBookRepository(db, clock);
    const failing = {
      inspect: epub.inspect,
      generateLocations: () => Promise.reject(new EpubImportError("unreadable")),
    };
    const service = createPlantBookService({ epub: failing, epubFiles, books });
    const prepared = await service.prepareEpub(file(buildEpub()));
    await expect(service.plantEpub(prepared, { title: "A", author: "B" })).rejects.toMatchObject({
      problem: "unreadable",
    });
    expect(await db.books.count()).toBe(0);
  });
});

describe("plantar un libro fisico", () => {
  it("crea el libro con sus paginas", async () => {
    const { service } = setup();
    const book = await service.plantPhysical({ title: "Kokoro", author: "Soseki", total_pages: 264 });
    expect(book).toMatchObject({ format_type: "PHYSICAL", total_pages: 264, current_page: 0, status: "ACTIVE" });
  });

  it("rechaza paginas invalidas con un error de campo", async () => {
    const { service } = setup();
    for (const total_pages of [0, -3, 2.5, 100_001]) {
      await expect(service.plantPhysical({ title: "A", author: "B", total_pages })).rejects.toMatchObject({
        code: "invalid_book",
        field: "total_pages",
      });
    }
    expect(await db.books.count()).toBe(0);
  });
});

describe("reimportar un EPUB", () => {
  it("restituye el archivo y las locations sin tocar el libro ni su progreso", async () => {
    const { service, epubFiles, books } = setup();
    const prepared = await service.prepareEpub(file(buildEpub()));
    const book = await service.plantEpub(prepared, { title: "A", author: "B" });
    await db.epub_files.delete(book.id); // Safari lo purgo
    expect(await epubFiles.hasFile(book.id)).toBe(false);
    await db.books.update(book.id, { progress_percentage: 42, last_epub_cfi: "epubcfi(/6/4)" });

    await service.reimportEpub(book.id, file(buildEpub({ chapters: ["Otro texto. ".repeat(100)] })));
    expect(await epubFiles.hasFile(book.id)).toBe(true);
    expect(await epubFiles.getLocations(book.id)).not.toBeNull();
    expect(await books.getBook(book.id)).toMatchObject({ progress_percentage: 42, last_epub_cfi: "epubcfi(/6/4)" });
  });

  it("un archivo invalido no reemplaza nada", async () => {
    const { service, epubFiles } = setup();
    const prepared = await service.prepareEpub(file(buildEpub()));
    const book = await service.plantEpub(prepared, { title: "A", author: "B" });
    const before = (await epubFiles.getFile(book.id))?.size_bytes;
    await expect(service.reimportEpub(book.id, file(new TextEncoder().encode("hola").buffer))).rejects.toMatchObject({
      problem: "not_epub",
    });
    expect((await epubFiles.getFile(book.id))?.size_bytes).toBe(before);
  });
});
