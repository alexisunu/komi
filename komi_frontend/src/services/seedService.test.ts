import { afterEach, describe, expect, it, vi } from "vitest";
import { createLocalReflectionRepository } from "../data/local_db/localReflectionRepository";
import { createLocalSessionRepository } from "../data/local_db/localSessionRepository";
import type { LocalSession } from "../data/local_db/types";
import { createTestDb, fakeClock, uuid } from "../test/db";
import { createSeedService, longDateEs, seedCountLabel } from "./seedService";

function session(n: number, bookN: number, startedAtLocal: string): LocalSession {
  return {
    id: uuid(n),
    book_id: uuid(bookN),
    planned_duration_sec: 900,
    actual_duration_sec: 900,
    started_at_local: startedAtLocal,
    session_status: "COMPLETED",
    current_page: 10,
    progress_percentage: null,
    last_epub_cfi: null,
    extracted_epub_excerpt: null,
    progress_delta: 1,
    granted_solar_bonus: false,
    pending_sync: 0,
    sync_rejection: null,
  };
}

function setup() {
  const db = createTestDb();
  const clock = fakeClock();
  const reflections = createLocalReflectionRepository(db, clock);
  const sessions = createLocalSessionRepository(db, clock);
  return { db, clock, reflections, sessions, service: createSeedService({ reflections, sessions }) };
}

const closed = { turn_count: 5, is_closed: true };

afterEach(() => vi.unstubAllEnvs());

describe("fecha larga en espanol", () => {
  it("usa dia sin cero, mes en minuscula y ano", () => {
    expect(longDateEs("2026-11-05T23:50:00")).toBe("5 de noviembre de 2026");
    expect(longDateEs("2027-01-01T00:05:00")).toBe("1 de enero de 2027");
    expect(longDateEs("2026-12-31")).toBe("31 de diciembre de 2026");
  });

  it("un texto invalido no inventa una fecha", () => {
    expect(longDateEs("")).toBe("");
    expect(longDateEs("ayer")).toBe("");
    expect(longDateEs("2026-13-01T00:00:00")).toBe("");
  });
});

describe("contador", () => {
  it("singular y plural", () => {
    expect(seedCountLabel(1)).toBe("1 semilla");
    expect(seedCountLabel(2)).toBe("2 semillas");
    expect(seedCountLabel(0)).toBe("0 semillas");
  });
});

describe("semillas por libro", () => {
  it("agrupa por libro, de la mas reciente a la mas antigua segun la hora local de la sesion", async () => {
    const { db, reflections, sessions, service } = setup();
    await db.sessions.bulkAdd([
      session(50, 1, "2026-11-01T08:00:00"),
      session(51, 1, "2026-11-03T08:00:00"),
      session(52, 2, "2026-11-02T08:00:00"),
    ]);
    await reflections.upsert({ chat_id: uuid(10), session_id: uuid(50), book_id: uuid(1), ...closed, key_takeaway: "Antigua" });
    await reflections.upsert({ chat_id: uuid(11), session_id: uuid(51), book_id: uuid(1), ...closed, key_takeaway: "Reciente" });
    await reflections.upsert({ chat_id: uuid(12), session_id: uuid(52), book_id: uuid(2), ...closed, key_takeaway: "Otro" });
    void sessions;

    const byBook = await service.loadByBook();
    expect(byBook.get(uuid(1))?.map((s) => s.text)).toEqual(["Reciente", "Antigua"]);
    expect(byBook.get(uuid(2))?.map((s) => s.text)).toEqual(["Otro"]);
    expect(byBook.get(uuid(1))?.[0]?.dateLabel).toBe("3 de noviembre de 2026");
    db.close();
  });

  it("no incluye charlas abiertas ni cerradas sin frase", async () => {
    const { db, reflections, service } = setup();
    await reflections.upsert({ chat_id: uuid(10), session_id: uuid(50), book_id: uuid(1), turn_count: 3, is_closed: false });
    await reflections.upsert({ chat_id: uuid(11), session_id: uuid(51), book_id: uuid(1), ...closed });
    expect((await service.loadByBook()).size).toBe(0);
    db.close();
  });

  it("una charla cerca de la medianoche lleva el dia local de la sesion, no el del instante UTC", async () => {
    const { db, clock, reflections, service } = setup();
    // 23:50 locales del 5 de noviembre; la charla se guarda ya en el 6 en UTC.
    await db.sessions.add(session(50, 1, "2026-11-05T23:50:00"));
    clock.advance(0);
    await reflections.upsert({ chat_id: uuid(10), session_id: uuid(50), book_id: uuid(1), ...closed, key_takeaway: "Noche" });
    await db.reflections.update(uuid(10), { updated_at: "2026-11-06T04:55:00.000Z" });

    const [seed] = (await service.loadByBook()).get(uuid(1)) ?? [];
    expect(seed?.dateLabel).toBe("5 de noviembre de 2026");
    expect(seed?.startedAtLocal).toBe("2026-11-05T23:50:00");
    db.close();
  });

  it("una sesion justo despues de medianoche cuenta en el dia nuevo", async () => {
    const { db, reflections, service } = setup();
    await db.sessions.add(session(50, 1, "2026-11-06T00:10:00"));
    await reflections.upsert({ chat_id: uuid(10), session_id: uuid(50), book_id: uuid(1), ...closed, key_takeaway: "Madrugada" });
    await db.reflections.update(uuid(10), { updated_at: "2026-11-05T23:30:00.000Z" });
    const [seed] = (await service.loadByBook()).get(uuid(1)) ?? [];
    expect(seed?.dateLabel).toBe("6 de noviembre de 2026");
    db.close();
  });

  it("sin la sesion usa la hora de pared del dispositivo, no el texto UTC", async () => {
    const { db, reflections, service } = setup();
    await reflections.upsert({ chat_id: uuid(10), session_id: uuid(50), book_id: uuid(1), ...closed, key_takeaway: "Huerfana" });
    const instant = new Date(2026, 10, 5, 23, 50, 0); // 23:50 locales del dispositivo
    await db.reflections.update(uuid(10), { updated_at: instant.toISOString() });
    const [seed] = (await service.loadByBook()).get(uuid(1)) ?? [];
    expect(seed?.startedAtLocal).toBe("2026-11-05T23:50:00");
    expect(seed?.dateLabel).toBe("5 de noviembre de 2026");
    db.close();
  });
});
