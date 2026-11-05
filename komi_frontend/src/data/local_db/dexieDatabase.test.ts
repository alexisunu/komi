import Dexie from "dexie";
import { describe, expect, it } from "vitest";
import { createTestDb, fakeIndexedDb, uuid } from "../../test/db";
import {
  KomiDatabase,
  SCHEMA_VERSION,
  STORES_V1,
  STORES_V2,
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

describe("esquema actual (v2)", () => {
  it("declara la version 2 y se abre con ella", async () => {
    const db = createTestDb();
    await db.open();
    expect(SCHEMA_VERSION).toBe(2);
    expect(db.verno).toBe(2);
    db.close();
  });

  it("tiene las 6 tablas con sus claves e indices (los de las consultas reales)", async () => {
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
      epub_files: { primaryKey: "book_id", indexes: [] },
      meta: { primaryKey: "key", indexes: [] },
      profile: { primaryKey: "id", indexes: [] },
      reflections: { primaryKey: "chat_id", indexes: ["book_id", "session_id"] },
      sessions: {
        primaryKey: "id",
        indexes: ["[book_id+started_at_local]", "book_id", "pending_sync", "started_at_local"],
      },
    });
    expect(Object.keys(STORES_V1).sort()).toEqual(["books", "meta", "profile", "sessions"]);
    expect(Object.keys(STORES_V2).sort()).toEqual(["epub_files", "reflections"]);
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

/** Base creada como la dejo el Sprint 3: solo la v1, con sesiones sin `sync_rejection`. */
class DatabaseV1 extends Dexie {
  declare books: Dexie.Table<LocalBook, string>;
  declare sessions: Dexie.Table<Record<string, unknown> & { id: string }, string>;
  declare profile: Dexie.Table<{ id: string; profile_id: string }, string>;
  declare meta: Dexie.Table<{ key: string; value: unknown }, string>;
  constructor(name: string, deps: ReturnType<typeof fakeIndexedDb>) {
    super(name, deps);
    this.version(1).stores(STORES_V1);
  }
}

function v1Session(id: string, bookId: string, status: string, startedAt: string) {
  return {
    id,
    book_id: bookId,
    planned_duration_sec: 900,
    actual_duration_sec: 900,
    started_at_local: startedAt,
    session_status: status,
    current_page: 10,
    progress_percentage: null,
    last_epub_cfi: null,
    extracted_epub_excerpt: null,
    progress_delta: 3.78,
    granted_solar_bonus: false,
    pending_sync: 1,
  };
}

describe("migracion de esquema v1 a v2", () => {
  it("una base v1 con datos se abre en v2 sin perder nada y con las tablas nuevas vacias", async () => {
    const deps = fakeIndexedDb();

    const old = new DatabaseV1("migrar", deps);
    await old.books.bulkAdd([sampleBook(uuid(1)), sampleBook(uuid(2))]);
    await old.sessions.bulkAdd([
      v1Session(uuid(50), uuid(1), "COMPLETED", "2026-11-05T21:30:00"),
      v1Session(uuid(51), uuid(1), "INVALIDATED_GRACE_EXPIRED", "2026-11-06T08:00:00"),
    ]);
    await old.profile.add({ id: "local", profile_id: uuid(99) });
    await old.meta.put({ key: "streak_current", value: 4 });
    expect(old.verno).toBe(1);
    old.close();

    const db = new KomiDatabase("migrar", deps);
    await db.open();
    expect(db.verno).toBe(2);

    // Nada se perdio ni cambio.
    expect(await db.books.count()).toBe(2);
    expect(await db.books.get(uuid(2))).toEqual(sampleBook(uuid(2)));
    expect((await db.profile.get("local"))?.profile_id).toBe(uuid(99));
    expect((await db.meta.get("streak_current"))?.value).toBe(4);
    const sessions = await db.sessions.orderBy("started_at_local").toArray();
    expect(sessions.map((s) => s.id)).toEqual([uuid(50), uuid(51)]);
    expect(sessions[0]).toMatchObject({ planned_duration_sec: 900, progress_delta: 3.78, pending_sync: 1 });

    // Las sesiones existentes estrenan `sync_rejection` en null (no undefined).
    expect(sessions.map((s) => s.sync_rejection)).toEqual([null, null]);

    // Las tablas nuevas existen, estan vacias y se pueden usar; los indices de la v1 siguen.
    expect(await db.epub_files.count()).toBe(0);
    expect(await db.reflections.count()).toBe(0);
    expect(await db.sessions.where("pending_sync").equals(1).count()).toBe(2);
    expect(await db.sessions.where("[book_id+started_at_local]").between([uuid(1), ""], [uuid(1), "￿"]).count()).toBe(2);
    await db.epub_files.add({
      book_id: uuid(1),
      data: new Uint8Array([1, 2, 3]).buffer,
      size_bytes: 3,
      locations: null,
      created_at: "2026-11-06T09:00:00.000Z",
    });
    expect((await db.epub_files.get(uuid(1)))?.size_bytes).toBe(3);
    db.close();
  });

  it("migrar dos veces no vuelve a tocar los datos", async () => {
    const deps = fakeIndexedDb();
    const old = new DatabaseV1("migrar-2", deps);
    await old.sessions.add(v1Session(uuid(50), uuid(1), "COMPLETED", "2026-11-05T21:30:00"));
    old.close();

    const first = new KomiDatabase("migrar-2", deps);
    await first.sessions.update(uuid(50), { sync_rejection: "future_start" });
    first.close();

    const second = new KomiDatabase("migrar-2", deps);
    expect((await second.sessions.get(uuid(50)))?.sync_rejection).toBe("future_start");
    second.close();
  });

  it("una base v1 vacia (instalacion nueva sin datos) tambien migra", async () => {
    const deps = fakeIndexedDb();
    new DatabaseV1("migrar-3", deps).close();
    const db = new KomiDatabase("migrar-3", deps);
    await db.open();
    expect(db.verno).toBe(2);
    expect(await db.sessions.count()).toBe(0);
    db.close();
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
