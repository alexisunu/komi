import Dexie from "dexie";
import { describe, expect, it } from "vitest";
import { createTestDb, fakeIndexedDb, uuid } from "../../test/db";
import {
  KomiDatabase,
  SCHEMA_VERSION,
  STORES_V1,
  getDatabase,
  probeStorage,
} from "./dexieDatabase";
import { StorageUnavailableError } from "./errors";
import type { LocalBook } from "./types";

function sampleBook(id = uuid(1)): LocalBook {
  return {
    id,
    title: "Kokoro",
    author: "Natsume Soseki",
    format_type: "PHYSICAL",
    sunflower_variant: "CLASSIC",
    status: "ACTIVE",
    total_pages: 264,
    current_page: 10,
    progress_percentage: 3.78,
    last_epub_cfi: null,
    created_at: "2026-11-05T10:00:00.000Z",
    completed_at: null,
    updated_at: "2026-11-05T10:00:00.000Z",
    pending_sync: 1,
  };
}

describe("esquema v1", () => {
  it("declara la version 1 y se abre con ella", async () => {
    const db = createTestDb();
    await db.open();
    expect(SCHEMA_VERSION).toBe(1);
    expect(db.verno).toBe(1);
    db.close();
  });

  it("tiene las 4 tablas con sus claves e indices (los de las consultas reales)", async () => {
    const db = createTestDb();
    await db.open();
    const snapshot = Object.fromEntries(
      db.tables.map((table) => [
        table.name,
        {
          primaryKey: table.schema.primKey.name,
          indexes: table.schema.indexes.map((index) => index.name).sort(),
        },
      ]),
    );
    expect(snapshot).toEqual({
      books: { primaryKey: "id", indexes: ["pending_sync", "status", "updated_at"] },
      meta: { primaryKey: "key", indexes: [] },
      profile: { primaryKey: "id", indexes: [] },
      sessions: {
        primaryKey: "id",
        indexes: ["[book_id+started_at_local]", "book_id", "pending_sync", "started_at_local"],
      },
    });
    expect(Object.keys(STORES_V1).sort()).toEqual(["books", "meta", "profile", "sessions"]);
    db.close();
  });

  it("no guarda archivos .epub todavia (sin tabla de blobs)", async () => {
    const db = createTestDb();
    await db.open();
    expect(db.tables.map((t) => t.name)).not.toContain("epubs");
    db.close();
  });

  it("los datos persisten al cerrar y volver a abrir la base", async () => {
    const deps = fakeIndexedDb();
    const first = new KomiDatabase("persist", deps);
    await first.books.add(sampleBook());
    first.close();

    const second = new KomiDatabase("persist", deps);
    expect((await second.books.get(uuid(1)))?.title).toBe("Kokoro");
    second.close();
  });
});

describe("migracion de esquema", () => {
  it("una base v1 con datos se abre con una v2 sin perder nada y estrena el indice nuevo", async () => {
    const deps = fakeIndexedDb();

    const v1 = new KomiDatabase("migrar", deps);
    await v1.books.bulkAdd([sampleBook(uuid(1)), sampleBook(uuid(2))]);
    await v1.sessions.add({
      id: uuid(50),
      book_id: uuid(1),
      planned_duration_sec: 900,
      actual_duration_sec: 900,
      started_at_local: "2026-11-05T21:30:00",
      session_status: "COMPLETED",
      current_page: 10,
      progress_percentage: null,
      last_epub_cfi: null,
      extracted_epub_excerpt: null,
      progress_delta: 3.78,
      granted_solar_bonus: false,
      pending_sync: 1,
    });
    v1.close();

    // Version futura de ejemplo, solo para la prueba: agrega un indice y transforma los datos.
    class FutureDatabase extends Dexie {
      declare books: Dexie.Table<LocalBook & { reading_goal?: number }, string>;
      declare sessions: Dexie.Table<{ id: string }, string>;
      constructor() {
        super("migrar", deps);
        this.version(1).stores(STORES_V1);
        this.version(2)
          .stores({ books: "id, status, updated_at, pending_sync, format_type" })
          .upgrade((tx) =>
            tx
              .table("books")
              .toCollection()
              .modify((book) => {
                book.reading_goal = 15;
              }),
          );
      }
    }

    const v2 = new FutureDatabase();
    await v2.open();
    expect(v2.verno).toBe(2);
    expect(await v2.books.count()).toBe(2);
    expect((await v2.books.get(uuid(2)))?.reading_goal).toBe(15);
    expect((await v2.books.get(uuid(1)))?.title).toBe("Kokoro"); // intacto
    expect(await v2.sessions.count()).toBe(1);
    expect(v2.table("books").schema.indexes.map((i) => i.name)).toContain("format_type");
    expect(await v2.books.where("format_type").equals("PHYSICAL").count()).toBe(2);
    v2.close();
  });
});

describe("probeStorage y almacenamiento no disponible", () => {
  it("devuelve ok cuando IndexedDB funciona", async () => {
    const db = createTestDb();
    expect(await probeStorage(db)).toEqual({ ok: true });
    db.close();
  });

  it("sin IndexedDB (API ausente) devuelve StorageUnavailableError", async () => {
    // Sin fabrica inyectada y sin fake-indexeddb global, jsdom no tiene indexedDB.
    const db = new KomiDatabase("sin-api");
    const probe = await probeStorage(db);
    expect(probe.ok).toBe(false);
    if (!probe.ok) {
      expect(probe.error).toBeInstanceOf(StorageUnavailableError);
      expect((probe.error as StorageUnavailableError).code).toBe("storage_unavailable");
    }
  });

  it("con IndexedDB bloqueado (SecurityError, modo privado) devuelve StorageUnavailableError", async () => {
    const blocked = {
      open() {
        throw new DOMException("acceso denegado", "SecurityError");
      },
      cmp: () => 0,
    };
    const db = new KomiDatabase("bloqueada", { indexedDB: blocked, IDBKeyRange: undefined } as never);
    const probe = await probeStorage(db);
    expect(probe.ok).toBe(false);
    if (!probe.ok) expect(probe.error).toBeInstanceOf(StorageUnavailableError);
  });
});

describe("getDatabase", () => {
  it("devuelve siempre la misma instancia y no abre la base al importar", () => {
    expect(getDatabase()).toBe(getDatabase());
    expect(getDatabase().isOpen()).toBe(false);
  });
});
