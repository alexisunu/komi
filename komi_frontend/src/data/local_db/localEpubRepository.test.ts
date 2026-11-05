import { describe, expect, it } from "vitest";
import { createTestDb, fakeClock, uuid } from "../../test/db";
import { StorageQuotaError } from "./errors";
import { createLocalEpubRepository } from "./localEpubRepository";

function bytes(...values: number[]): ArrayBuffer {
  return new Uint8Array(values).buffer;
}

function setup() {
  const db = createTestDb();
  const clock = fakeClock();
  return { db, clock, repo: createLocalEpubRepository(db, clock) };
}

describe("plantEpubBook", () => {
  it("crea el libro EPUB y guarda el archivo juntos", async () => {
    const { db, repo } = setup();
    const { book, created } = await repo.plantEpubBook(
      { id: uuid(1), title: "Kokoro", author: "Natsume Soseki" },
      bytes(1, 2, 3, 4),
    );
    expect(created).toBe(true);
    expect(book).toMatchObject({
      format_type: "EPUB",
      status: "ACTIVE",
      total_pages: null,
      progress_percentage: 0,
    });
    const file = await repo.getFile(uuid(1));
    expect(file).toMatchObject({ book_id: uuid(1), size_bytes: 4, locations: null });
    expect(new Uint8Array(file?.data ?? new ArrayBuffer(0))).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(await db.books.count()).toBe(1);
    db.close();
  });

  it("es idempotente por id: repetirlo no cambia el libro ni el archivo", async () => {
    const { db, repo } = setup();
    await repo.plantEpubBook({ id: uuid(1), title: "Kokoro", author: "Soseki" }, bytes(1, 2));
    const again = await repo.plantEpubBook({ id: uuid(1), title: "Otro", author: "Otro" }, bytes(9, 9, 9));
    expect(again.created).toBe(false);
    expect(again.book.title).toBe("Kokoro");
    expect((await repo.getFile(uuid(1)))?.size_bytes).toBe(2);
    db.close();
  });

  it("con la cuota llena no queda ni el libro ni el archivo y avisa con StorageQuotaError", async () => {
    const { db, repo } = setup();
    db.epub_files.hook("creating", () => {
      throw new DOMException("sin espacio", "QuotaExceededError");
    });
    await expect(
      repo.plantEpubBook({ id: uuid(1), title: "Kokoro", author: "Soseki" }, bytes(1, 2, 3)),
    ).rejects.toBeInstanceOf(StorageQuotaError);
    expect(await db.books.count()).toBe(0);
    expect(await db.epub_files.count()).toBe(0);
    db.close();
  });

  it("tras un fallo por cuota se puede volver a intentar y funciona", async () => {
    const { db, repo } = setup();
    let full = true;
    db.epub_files.hook("creating", () => {
      if (full) throw new DOMException("sin espacio", "QuotaExceededError");
    });
    await expect(
      repo.plantEpubBook({ id: uuid(1), title: "A", author: "B" }, bytes(1)),
    ).rejects.toBeInstanceOf(StorageQuotaError);
    full = false;
    const { created } = await repo.plantEpubBook({ id: uuid(1), title: "A", author: "B" }, bytes(1));
    expect(created).toBe(true);
    expect(await repo.hasFile(uuid(1))).toBe(true);
    db.close();
  });

  it("rechaza un archivo vacio y un titulo vacio sin guardar nada", async () => {
    const { db, repo } = setup();
    await expect(
      repo.plantEpubBook({ id: uuid(1), title: "A", author: "B" }, new ArrayBuffer(0)),
    ).rejects.toMatchObject({ code: "invalid_book", field: "file" });
    await expect(
      repo.plantEpubBook({ id: uuid(2), title: " ", author: "B" }, bytes(1)),
    ).rejects.toMatchObject({ code: "invalid_book", field: "title" });
    expect(await db.books.count()).toBe(0);
    expect(await db.epub_files.count()).toBe(0);
    db.close();
  });
});

describe("archivos y locations", () => {
  it("hasFile es falso sin archivo y verdadero con el", async () => {
    const { db, repo } = setup();
    expect(await repo.hasFile(uuid(1))).toBe(false);
    await repo.saveFile(uuid(1), bytes(1));
    expect(await repo.hasFile(uuid(1))).toBe(true);
    db.close();
  });

  it("guarda y lee las locations; sin archivo no crea una fila", async () => {
    const { db, repo } = setup();
    expect(await repo.saveLocations(uuid(1), "[0,1]")).toBe(false);
    expect(await db.epub_files.count()).toBe(0);

    await repo.saveFile(uuid(1), bytes(1, 2));
    expect(await repo.getLocations(uuid(1))).toBeNull();
    expect(await repo.saveLocations(uuid(1), '["epubcfi(/6/2)"]')).toBe(true);
    expect(await repo.getLocations(uuid(1))).toBe('["epubcfi(/6/2)"]');
    db.close();
  });

  it("reimportar el archivo reemplaza los bytes y descarta las locations viejas", async () => {
    const { db, repo } = setup();
    await repo.saveFile(uuid(1), bytes(1, 2));
    await repo.saveLocations(uuid(1), "viejas");
    await repo.saveFile(uuid(1), bytes(7, 8, 9));
    expect(await repo.getLocations(uuid(1))).toBeNull();
    expect((await repo.getFile(uuid(1)))?.size_bytes).toBe(3);
    db.close();
  });

  it("saveFile con la cuota llena lanza StorageQuotaError y conserva el archivo anterior", async () => {
    const { db, repo } = setup();
    await repo.saveFile(uuid(1), bytes(1, 2));
    db.epub_files.hook("updating", () => {
      throw new DOMException("sin espacio", "QuotaExceededError");
    });
    await expect(repo.saveFile(uuid(1), bytes(5, 5, 5))).rejects.toBeInstanceOf(StorageQuotaError);
    expect((await repo.getFile(uuid(1)))?.size_bytes).toBe(2);
    db.close();
  });
});
