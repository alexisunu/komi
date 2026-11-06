import { describe, expect, it } from "vitest";
import { createTestDb, fakeClock, uuid } from "../../test/db";
import { createLocalReflectionRepository } from "./localReflectionRepository";

function setup() {
  const db = createTestDb();
  const clock = fakeClock();
  return { db, clock, repo: createLocalReflectionRepository(db, clock) };
}

const base = { chat_id: uuid(10), session_id: uuid(50), book_id: uuid(1) };

describe("upsert de reflexiones", () => {
  it("crea la charla abierta, sin semilla", async () => {
    const { db, repo } = setup();
    const row = await repo.upsert({ ...base, turn_count: 1, is_closed: false });
    expect(row).toMatchObject({ turn_count: 1, is_closed: false, key_takeaway: null });
    expect(await repo.getBySession(uuid(50))).toEqual(row);
    db.close();
  });

  it("es monotono: no baja turnos, no reabre y no borra la semilla", async () => {
    const { db, repo } = setup();
    await repo.upsert({ ...base, turn_count: 5, is_closed: true, key_takeaway: "  Leer es sembrar.  " });
    const later = await repo.upsert({ ...base, turn_count: 2, is_closed: false, key_takeaway: null });
    expect(later).toMatchObject({ turn_count: 5, is_closed: true, key_takeaway: "Leer es sembrar." });
    db.close();
  });

  it("una semilla vacia o de espacios cuenta como ausente", async () => {
    const { db, repo } = setup();
    const row = await repo.upsert({ ...base, turn_count: 5, is_closed: true, key_takeaway: "   " });
    expect(row.key_takeaway).toBeNull();
    db.close();
  });

  it("repetir lo mismo no cambia updated_at", async () => {
    const { db, clock, repo } = setup();
    const first = await repo.upsert({ ...base, turn_count: 3, is_closed: false });
    clock.advance(60_000);
    const second = await repo.upsert({ ...base, turn_count: 3, is_closed: false });
    expect(second.updated_at).toBe(first.updated_at);
    db.close();
  });
});

describe("consultas", () => {
  it("las semillas de un libro son las charlas cerradas con frase, la mas reciente primero", async () => {
    const { db, clock, repo } = setup();
    const closed = { turn_count: 5, is_closed: true };
    await repo.upsert({ chat_id: uuid(10), session_id: uuid(50), book_id: uuid(1), ...closed, key_takeaway: "Uno" });
    clock.advance(1000);
    await repo.upsert({ chat_id: uuid(11), session_id: uuid(51), book_id: uuid(1), ...closed, key_takeaway: "Dos" });
    clock.advance(1000);
    await repo.upsert({ chat_id: uuid(12), session_id: uuid(52), book_id: uuid(1), ...closed }); // sin frase
    await repo.upsert({
      chat_id: uuid(13),
      session_id: uuid(53),
      book_id: uuid(1),
      turn_count: 2,
      is_closed: false,
      key_takeaway: "Abierta",
    });
    await repo.upsert({ chat_id: uuid(14), session_id: uuid(54), book_id: uuid(2), ...closed, key_takeaway: "Otro libro" });

    const seeds = await repo.listSeedsForBook(uuid(1));
    expect(seeds.map((s) => s.key_takeaway)).toEqual(["Dos", "Uno"]);
    expect(await repo.countClosed()).toBe(4);
    db.close();
  });

  it("listSeeds devuelve las charlas cerradas con frase de todos los libros", async () => {
    const { db, repo } = setup();
    const closed = { turn_count: 5, is_closed: true };
    await repo.upsert({ chat_id: uuid(10), session_id: uuid(50), book_id: uuid(1), ...closed, key_takeaway: "Uno" });
    await repo.upsert({ chat_id: uuid(11), session_id: uuid(51), book_id: uuid(2), ...closed, key_takeaway: "Dos" });
    await repo.upsert({ chat_id: uuid(12), session_id: uuid(52), book_id: uuid(2), ...closed });
    await repo.upsert({ chat_id: uuid(13), session_id: uuid(53), book_id: uuid(2), turn_count: 2, is_closed: false, key_takeaway: "Abierta" });
    const seeds = await repo.listSeeds();
    expect(seeds.map((s) => s.key_takeaway).sort()).toEqual(["Dos", "Uno"]);
    db.close();
  });
});
