// Cierre de sesion (CU-04) con Dexie real (fake-indexeddb) y reloj falso. Cada prueba afirma el
// estado guardado, no solo el valor devuelto, para que una mutacion en la regla la rompa.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KomiDatabase } from "../data/local_db/dexieDatabase";
import { StorageUnavailableError } from "../data/local_db/errors";
import { createLocalBookRepository } from "../data/local_db/localBookRepository";
import { createLocalEpubRepository } from "../data/local_db/localEpubRepository";
import { createLocalMetaRepository, META_KEYS } from "../data/local_db/localMetaRepository";
import { createLocalSessionRepository } from "../data/local_db/localSessionRepository";
import type { LocalBook } from "../data/local_db/types";
import { createTestDb, fakeClock, uuid, type FakeClock } from "../test/db";
import type { ActiveSession } from "./focusSessionMachine";
import {
  createPostReadingService,
  InvalidPageError,
  type PostReadingService,
  type PreparedSession,
} from "./postReadingService";
import type { ReadingProgress } from "./readingTracker";

type Ready = Extract<PreparedSession, { kind: "ready" }>;

const SESSION = uuid(500);
let db: KomiDatabase;
let clock: FakeClock;
let record: ActiveSession | null;
let progress: ReadingProgress | null;
let percentageAt: ReturnType<typeof vi.fn>;
let service: PostReadingService;
/** "Ahora" del reloj de la sesion (el de las marcas de tiempo), 6 nov 2026 12:00 local. */
let nowMs: number;

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

function active(over: Partial<ActiveSession> = {}): ActiveSession {
  return {
    sessionId: SESSION,
    bookId: uuid(1),
    plannedSec: 900,
    timerType: "TIMER",
    startedAt: 0,
    startedAtLocal: "2026-11-06T11:30:00",
    hiddenAt: null,
    lastSeen: 0,
    finalSec: 900,
    ...over,
  };
}

function build(): PostReadingService {
  return createPostReadingService({
    loadActiveSession: async () => record,
    loadProgress: async () => progress,
    books: createLocalBookRepository(db, clock),
    sessions: createLocalSessionRepository(db, clock),
    epubFiles: createLocalEpubRepository(db, clock),
    epub: { percentageAt: percentageAt as never },
    meta: createLocalMetaRepository(db),
    now: () => nowMs,
  });
}

async function ready(): Promise<Ready> {
  const prepared = await service.prepare(SESSION);
  if (prepared.kind !== "ready") throw new Error(`no esta lista: ${prepared.reason}`);
  return prepared;
}

async function streakMeta(): Promise<unknown> {
  return (await db.meta.get(META_KEYS.streakCurrent))?.value;
}

beforeEach(async () => {
  db = createTestDb();
  clock = fakeClock("2026-11-06T12:00:00.000Z");
  nowMs = new Date(2026, 10, 6, 12, 0, 0).getTime();
  record = active();
  progress = null;
  percentageAt = vi.fn(async () => 50);
  service = build();
  await db.books.put(book());
});
afterEach(() => db.close());

describe("prepare", () => {
  it("sin registro de sesion, o de otra sesion, no hay nada que cerrar", async () => {
    record = null;
    expect(await service.prepare(SESSION)).toEqual({ kind: "missing", reason: "record" });
    record = active({ sessionId: uuid(501) });
    expect(await service.prepare(SESSION)).toEqual({ kind: "missing", reason: "record" });
  });

  it("sin el libro avisa por separado", async () => {
    record = active({ bookId: uuid(99) });
    expect(await service.prepare(SESSION)).toEqual({ kind: "missing", reason: "book" });
  });

  it("finalSec nulo solo se acepta con el respaldo de la pantalla", async () => {
    record = active({ finalSec: null });
    expect(await service.prepare(SESSION)).toEqual({ kind: "missing", reason: "record" });
    expect(await service.prepare(SESSION, 600)).toMatchObject({ kind: "ready", actualSec: 600 });
  });

  it("el registro manda sobre el respaldo", async () => {
    record = active({ finalSec: 450 });
    expect(await service.prepare(SESSION, 600)).toMatchObject({ actualSec: 450 });
  });

  it("short es estricto: exactamente 5 minutos no es corta", async () => {
    record = active({ finalSec: 300 });
    expect(await ready()).toMatchObject({ short: false });
    record = active({ finalSec: 299 });
    expect(await ready()).toMatchObject({ short: true });
  });

  it("ignora el avance de otra sesion", async () => {
    progress = { sessionId: uuid(777), cfi: "cfi-ajeno", percentage: 80, excerpt: "otro", updatedAt: 1 };
    expect((await ready()).progress).toBeNull();
    progress = { sessionId: SESSION, cfi: "cfi", percentage: 30, excerpt: "texto", updatedAt: 1 };
    expect((await ready()).progress).toMatchObject({ cfi: "cfi" });
  });
});

describe("libro fisico: pagina", () => {
  it.each([[0], [-1], [301], [1.5], [Number.NaN]])("la pagina %s no vale: aviso y nada se guarda", async (page) => {
    const prepared = await ready();
    await expect(service.save(prepared, { page })).rejects.toBeInstanceOf(InvalidPageError);
    expect(await db.sessions.count()).toBe(0);
    expect(await streakMeta()).toBeUndefined();
  });

  it("sin pagina tampoco vale", async () => {
    await expect(service.save(await ready())).rejects.toThrow(/entre 1 y 300/);
  });

  it("la ultima pagina (total_pages) si vale", async () => {
    const result = await service.save(await ready(), { page: 300 });
    expect(result.kind).toBe("saved");
  });

  it("guarda sesion y libro: pagina, porcentaje truncado y estado derivado", async () => {
    const result = await service.save(await ready(), { page: 100 });
    expect(result).toMatchObject({ kind: "saved", created: true, before: 10, bloomed: false, solarBonus: false });
    expect(await db.sessions.get(SESSION)).toMatchObject({
      book_id: uuid(1),
      planned_duration_sec: 900,
      actual_duration_sec: 900,
      started_at_local: "2026-11-06T11:30:00",
      session_status: "COMPLETED",
      current_page: 100,
      progress_delta: 23.33,
      granted_solar_bonus: false,
      pending_sync: 1,
    });
    expect(await db.books.get(uuid(1))).toMatchObject({
      current_page: 100,
      progress_percentage: 33.33,
      pending_sync: 1,
    });
  });

  it("terminar antes (5 minutos o mas) queda COMPLETED", async () => {
    record = active({ finalSec: 450 });
    await service.save(await ready(), { page: 40 });
    expect((await db.sessions.get(SESSION))?.session_status).toBe("COMPLETED");
  });

  it("una pagina menor a la guardada no baja el avance ni la pagina y el Bono Solar aplica", async () => {
    const result = await service.save(await ready(), { page: 10 });
    expect(result).toMatchObject({ kind: "saved", solarBonus: true });
    expect(await db.books.get(uuid(1))).toMatchObject({
      current_page: 30,
      progress_percentage: 10,
      updated_at: "2026-11-01T00:00:00.000Z",
    });
    expect(await db.sessions.get(SESSION)).toMatchObject({ current_page: 10 });
  });
});

describe("Bono de Vitalidad Solar", () => {
  beforeEach(async () => {
    await db.books.put(book({ total_pages: 1000, current_page: 100, progress_percentage: 10 }));
  });

  it("libro fisico, sesion valida y avance menor de 1: se otorga", async () => {
    const result = await service.save(await ready(), { page: 109 }); // 10.9 - 10 = 0.9
    expect(result).toMatchObject({ solarBonus: true });
    expect((await db.sessions.get(SESSION))?.granted_solar_bonus).toBe(true);
  });

  it("avance de exactamente 1 punto: no se otorga", async () => {
    const result = await service.save(await ready(), { page: 110 });
    expect(result).toMatchObject({ solarBonus: false });
    expect((await db.sessions.get(SESSION))?.granted_solar_bonus).toBe(false);
  });

  it("avance de 0,99: se otorga", async () => {
    const result = await service.save(await ready(), { page: 109 });
    expect(result).toMatchObject({ solarBonus: true });
  });

  it("un EPUB nunca lo recibe, ni con avance menor de 1", async () => {
    await db.books.put(book({ format_type: "EPUB", total_pages: null, current_page: 0 }));
    progress = { sessionId: SESSION, cfi: "cfi", percentage: 10.5, excerpt: "", updatedAt: 1 };
    const result = await service.save(await ready());
    expect(result).toMatchObject({ kind: "saved", solarBonus: false });
  });
});

describe("florecimiento", () => {
  it("la ultima pagina lleva al 100 %: BLOOMED, completed_at y bloomed verdadero", async () => {
    const result = await service.save(await ready(), { page: 300 });
    expect(result).toMatchObject({ kind: "saved", bloomed: true });
    expect(await db.books.get(uuid(1))).toMatchObject({
      progress_percentage: 100,
      status: "BLOOMED",
      completed_at: "2026-11-06T12:00:00.000Z",
    });
  });

  it("la penultima pagina no florece: 99,66 y sigue en curso", async () => {
    const result = await service.save(await ready(), { page: 299 });
    expect(result).toMatchObject({ bloomed: false });
    expect(await db.books.get(uuid(1))).toMatchObject({ progress_percentage: 99.66, completed_at: null });
    expect((await db.books.get(uuid(1)))?.status).not.toBe("BLOOMED");
  });

  it("repetir el guardado no vuelve a florecer ni toca completed_at", async () => {
    const prepared = await ready();
    await service.save(prepared, { page: 300 });
    const bloomedBook = await db.books.get(uuid(1));
    clock.advance(60_000);
    const again = await service.save(prepared, { page: 300 });
    expect(again).toMatchObject({ kind: "saved", created: false, bloomed: false });
    expect(await db.books.get(uuid(1))).toEqual(bloomedBook);
  });

  it("EPUB: el 100 % exacto florece; 99,99 no", async () => {
    await db.books.put(book({ format_type: "EPUB", total_pages: null, current_page: 0 }));
    record = active({ finalSec: 100 });
    progress = { sessionId: SESSION, cfi: "cfi-fin", percentage: 99.99, excerpt: "", updatedAt: 1 };
    // Menos del 50 % y sin llegar a 100: no vale.
    expect((await service.save(await ready())).kind).toBe("discarded");
    progress = { sessionId: SESSION, cfi: "cfi-fin", percentage: 100, excerpt: "", updatedAt: 1 };
    expect(await service.save(await ready())).toMatchObject({ kind: "saved", bloomed: true });
    expect(await db.books.get(uuid(1))).toMatchObject({ status: "BLOOMED", last_epub_cfi: "cfi-fin" });
  });
});

describe("menos del 50 % del tiempo (Terminé el libro)", () => {
  beforeEach(() => {
    record = active({ finalSec: 200 });
  });

  it("una pagina que no es la ultima descarta la sesion sin guardar nada", async () => {
    const result = await service.save(await ready(), { page: 299 });
    expect(result).toEqual({ kind: "discarded" });
    expect(await db.sessions.count()).toBe(0);
    expect(await db.books.get(uuid(1))).toMatchObject({ progress_percentage: 10, current_page: 30 });
    expect(await streakMeta()).toBeUndefined();
  });

  it("la ultima pagina vale: COMPLETED, florece y cuenta para la racha", async () => {
    const result = await service.save(await ready(), { page: 300 });
    expect(result).toMatchObject({ kind: "saved", bloomed: true, streak: 1 });
    expect((await db.sessions.get(SESSION))?.session_status).toBe("COMPLETED");
  });

  it("una pagina invalida sigue siendo aviso gentil, no descarte", async () => {
    await expect(service.save(await ready(), { page: 301 })).rejects.toBeInstanceOf(InvalidPageError);
  });
});

describe("idempotencia", () => {
  it("guardar dos veces la misma sesion no duplica sesion, avance ni racha", async () => {
    const prepared = await ready();
    const first = await service.save(prepared, { page: 100 });
    const snapshot = {
      sessions: await db.sessions.toArray(),
      book: await db.books.get(uuid(1)),
      streak: await streakMeta(),
    };
    clock.advance(120_000);
    const second = await service.save(prepared, { page: 100 });
    expect(first).toMatchObject({ created: true });
    expect(second).toMatchObject({ created: false, streak: 1 });
    expect(await db.sessions.count()).toBe(1);
    expect(await db.sessions.toArray()).toEqual(snapshot.sessions);
    expect(await db.books.get(uuid(1))).toEqual(snapshot.book);
    expect(await streakMeta()).toBe(snapshot.streak);
  });

  it("un reintento con otra pagina no pisa la sesion ya guardada", async () => {
    const prepared = await ready();
    await service.save(prepared, { page: 100 });
    await service.save(prepared, { page: 250 });
    expect(await db.sessions.get(SESSION)).toMatchObject({ current_page: 100 });
    expect(await db.books.get(uuid(1))).toMatchObject({ current_page: 100 });
  });
});

describe("libro en barbecho o florecido", () => {
  it("barbecho: la sesion valida se guarda, conserva FALLOW y sube con MAX", async () => {
    await db.books.put(book({ status: "FALLOW" }));
    const result = await service.save(await ready(), { page: 90 });
    expect(result).toMatchObject({ kind: "saved", bloomed: false });
    expect(await db.books.get(uuid(1))).toMatchObject({ status: "FALLOW", progress_percentage: 30, current_page: 90 });
    expect((await db.sessions.get(SESSION))?.session_status).toBe("COMPLETED");
  });

  it("barbecho que llega al 100 % por primera vez pasa a BLOOMED", async () => {
    await db.books.put(book({ status: "FALLOW" }));
    const result = await service.save(await ready(), { page: 300 });
    expect(result).toMatchObject({ bloomed: true });
    expect(await db.books.get(uuid(1))).toMatchObject({ status: "BLOOMED", progress_percentage: 100 });
  });

  it("florecido: la sesion se guarda y el libro no cambia en nada (ni updated_at)", async () => {
    const bloomed = book({
      status: "BLOOMED",
      progress_percentage: 100,
      current_page: 300,
      completed_at: "2026-10-01T00:00:00.000Z",
      updated_at: "2026-10-01T00:00:00.000Z",
    });
    await db.books.put(bloomed);
    const result = await service.save(await ready(), { page: 120 });
    expect(result).toMatchObject({ kind: "saved", bloomed: false });
    expect(await db.sessions.count()).toBe(1);
    expect(await db.books.get(uuid(1))).toEqual(bloomed);
  });

  it("nunca se guarda como invalidada por estar en barbecho o florecido", async () => {
    await db.books.put(book({ status: "FALLOW" }));
    await service.save(await ready(), { page: 90 });
    expect((await db.sessions.get(SESSION))?.session_status).not.toBe("INVALIDATED_GRACE_EXPIRED");
  });
});

describe("EPUB: porcentaje, CFI y extracto", () => {
  beforeEach(async () => {
    await db.books.put(book({ format_type: "EPUB", total_pages: null, current_page: 0 }));
    await db.epub_files.put({
      book_id: uuid(1),
      data: new Uint8Array([1, 2, 3]).buffer,
      size_bytes: 3,
      locations: '["a","b"]',
      created_at: "2026-11-01T00:00:00.000Z",
    });
  });

  it("usa el porcentaje, el CFI y el extracto de active_session_progress", async () => {
    progress = { sessionId: SESSION, cfi: "cfi-9", percentage: 42.5, excerpt: "Lo que se leyo hoy.", updatedAt: 1 };
    const result = await service.save(await ready());
    expect(result).toMatchObject({ kind: "saved", solarBonus: false });
    expect(percentageAt).not.toHaveBeenCalled();
    expect(await db.sessions.get(SESSION)).toMatchObject({
      last_epub_cfi: "cfi-9",
      extracted_epub_excerpt: "Lo que se leyo hoy.",
      progress_percentage: 42.5,
      current_page: null,
    });
    expect(await db.books.get(uuid(1))).toMatchObject({ progress_percentage: 42.5, last_epub_cfi: "cfi-9" });
  });

  it("sin porcentaje calcula el valor exacto con percentageAt y las locations guardadas", async () => {
    progress = { sessionId: SESSION, cfi: "cfi-9", percentage: null, excerpt: "x", updatedAt: 1 };
    percentageAt.mockResolvedValueOnce(61.37);
    const onPreparing = vi.fn();
    await service.save(await ready(), { onPreparing });
    expect(percentageAt).toHaveBeenCalledWith(expect.anything(), "cfi-9", '["a","b"]', undefined);
    expect(onPreparing).not.toHaveBeenCalled();
    expect(await db.books.get(uuid(1))).toMatchObject({ progress_percentage: 61.37 });
  });

  it("si faltan las locations avisa antes de generarlas y reenvia el avance", async () => {
    await db.epub_files.update(uuid(1), { locations: null });
    progress = { sessionId: SESSION, cfi: "cfi-9", percentage: null, excerpt: "", updatedAt: 1 };
    const onProgress = vi.fn();
    const onPreparing = vi.fn();
    await service.save(await ready(), { onPreparing, onProgress });
    expect(onPreparing).toHaveBeenCalledTimes(1);
    expect(percentageAt).toHaveBeenCalledWith(expect.anything(), "cfi-9", null, onProgress);
  });

  it("si no se puede calcular no se inventa un porcentaje: la sesion se guarda y el avance se conserva", async () => {
    progress = { sessionId: SESSION, cfi: "cfi-9", percentage: null, excerpt: "texto", updatedAt: 1 };
    percentageAt.mockRejectedValueOnce(new Error("epub danado"));
    const result = await service.save(await ready());
    expect(result.kind).toBe("saved");
    expect(await db.books.get(uuid(1))).toMatchObject({ progress_percentage: 10, last_epub_cfi: null });
    expect(await db.sessions.get(SESSION)).toMatchObject({ progress_percentage: 10, last_epub_cfi: null });
  });

  it("si el archivo ya no esta, igual: se conserva el avance", async () => {
    await db.epub_files.delete(uuid(1));
    progress = { sessionId: SESSION, cfi: "cfi-9", percentage: null, excerpt: "", updatedAt: 1 };
    await service.save(await ready());
    expect(percentageAt).not.toHaveBeenCalled();
    expect(await db.books.get(uuid(1))).toMatchObject({ progress_percentage: 10 });
  });

  it("sin registro de avance se guarda la sesion sin mover el libro ni inventar extracto", async () => {
    progress = null;
    await service.save(await ready());
    expect(await db.sessions.get(SESSION)).toMatchObject({ extracted_epub_excerpt: null, last_epub_cfi: null });
    expect(await db.books.get(uuid(1))).toMatchObject({ progress_percentage: 10 });
  });

  it("el avance de otra sesion no se usa", async () => {
    progress = { sessionId: uuid(777), cfi: "cfi-ajeno", percentage: 90, excerpt: "ajeno", updatedAt: 1 };
    await service.save(await ready());
    expect(await db.books.get(uuid(1))).toMatchObject({ progress_percentage: 10, last_epub_cfi: null });
    expect((await db.sessions.get(SESSION))?.extracted_epub_excerpt).toBeNull();
  });

  it("un porcentaje menor al guardado no baja el libro ni mueve el CFI", async () => {
    await db.books.put(book({ format_type: "EPUB", total_pages: null, current_page: 0, last_epub_cfi: "cfi-viejo" }));
    progress = { sessionId: SESSION, cfi: "cfi-atras", percentage: 5, excerpt: "", updatedAt: 1 };
    await service.save(await ready());
    expect(await db.books.get(uuid(1))).toMatchObject({ progress_percentage: 10, last_epub_cfi: "cfi-viejo" });
  });
});

describe("racha local", () => {
  async function seedSession(id: number, startedAtLocal: string, status = "COMPLETED") {
    await db.sessions.put({
      id: uuid(id),
      book_id: uuid(1),
      planned_duration_sec: 900,
      actual_duration_sec: 900,
      started_at_local: startedAtLocal,
      session_status: status as never,
      current_page: 30,
      progress_percentage: null,
      last_epub_cfi: null,
      extracted_epub_excerpt: null,
      progress_delta: 0,
      granted_solar_bonus: false,
      pending_sync: 0,
      sync_rejection: null,
    });
  }

  it("la primera sesion valida deja la racha en 1 y la guarda en meta", async () => {
    const result = await service.save(await ready(), { page: 60 });
    expect(result).toMatchObject({ streak: 1 });
    expect(await streakMeta()).toBe(1);
  });

  it("ayer + hoy suman 2; un dia sin leer la reinicia a 1", async () => {
    await seedSession(10, "2026-11-05T21:00:00");
    expect((await service.save(await ready(), { page: 60 })).kind).toBe("saved");
    expect(await streakMeta()).toBe(2);
  });

  it("un hueco de un dia reinicia la racha", async () => {
    await seedSession(10, "2026-11-04T21:00:00");
    await service.save(await ready(), { page: 60 });
    expect(await streakMeta()).toBe(1);
  });

  it("dos sesiones el mismo dia cuentan una sola vez", async () => {
    await seedSession(10, "2026-11-06T08:00:00");
    await service.save(await ready(), { page: 60 });
    expect(await streakMeta()).toBe(1);
  });

  it("una lectura que cruza la medianoche cuenta en el dia de inicio (started_at_local)", async () => {
    // Empezo el 5 a las 23:50 y termino ya el 6: cuenta como dia 5; con la de ayer son 2 dias.
    await seedSession(10, "2026-11-04T22:00:00");
    record = active({ startedAtLocal: "2026-11-05T23:50:00" });
    nowMs = new Date(2026, 10, 6, 0, 5, 0).getTime();
    const result = await service.save(await ready(), { page: 60 });
    expect(result).toMatchObject({ streak: 2 });
    expect(await streakMeta()).toBe(2);
  });

  it("las sesiones invalidadas o rechazadas no cuentan", async () => {
    await seedSession(10, "2026-11-05T21:00:00", "INVALIDATED_GRACE_EXPIRED");
    await db.sessions.update(uuid(10), { sync_rejection: "below_50_percent" });
    await seedSession(11, "2026-11-05T22:00:00");
    await db.sessions.update(uuid(11), { sync_rejection: "future_start" });
    await service.save(await ready(), { page: 60 });
    expect(await streakMeta()).toBe(1);
  });

  it("si escribir la racha falla, la sesion ya guardada no se pierde ni se reporta error", async () => {
    const failing = createPostReadingService({
      loadActiveSession: async () => record,
      loadProgress: async () => progress,
      books: createLocalBookRepository(db, clock),
      sessions: createLocalSessionRepository(db, clock),
      epubFiles: createLocalEpubRepository(db, clock),
      epub: { percentageAt: percentageAt as never },
      meta: { set: async () => Promise.reject(new StorageUnavailableError()) },
      now: () => nowMs,
    });
    const prepared = await failing.prepare(SESSION);
    if (prepared.kind !== "ready") throw new Error("no lista");
    const result = await failing.save(prepared, { page: 60 });
    expect(result).toMatchObject({ kind: "saved", streak: 1 });
    expect(await db.sessions.count()).toBe(1);
  });
});

describe("fallo de Dexie", () => {
  it("si guardar falla no queda nada a medias: ni sesion, ni libro cambiado, ni racha", async () => {
    const add = vi.spyOn(db.sessions, "add").mockRejectedValueOnce(new Error("sin espacio"));
    await expect(service.save(await ready(), { page: 120 })).rejects.toBeDefined();
    add.mockRestore();
    expect(await db.sessions.count()).toBe(0);
    expect(await db.books.get(uuid(1))).toMatchObject({ current_page: 30, progress_percentage: 10 });
    expect(await streakMeta()).toBeUndefined();
  });

  it("tras el fallo, reintentar con los mismos datos guarda bien una sola vez", async () => {
    const prepared = await ready();
    const add = vi.spyOn(db.sessions, "add").mockRejectedValueOnce(new Error("sin espacio"));
    await expect(service.save(prepared, { page: 120 })).rejects.toBeDefined();
    add.mockRestore();
    const result = await service.save(prepared, { page: 120 });
    expect(result).toMatchObject({ kind: "saved", created: true });
    expect(await db.sessions.count()).toBe(1);
    expect(await db.books.get(uuid(1))).toMatchObject({ current_page: 120, progress_percentage: 40 });
  });

  it("prepare no escribe nada en ninguna tabla", async () => {
    await ready();
    expect(await db.sessions.count()).toBe(0);
    expect(await db.meta.count()).toBe(0);
  });
});

describe("modo libre al cerrar la sesion", () => {
  const sent = async () => {
    const stored = await db.sessions.get(SESSION);
    return stored && { planned: stored.planned_duration_sec, actual: stored.actual_duration_sec, status: stored.session_status };
  };

  it("con 10 minutos envia planned = actual y COMPLETED", async () => {
    record = active({ timerType: "FREE", plannedSec: 7200, finalSec: 600 });
    expect(await service.save(await ready(), { page: 100 })).toMatchObject({ kind: "saved" });
    expect(await sent()).toEqual({ planned: 600, actual: 600, status: "COMPLETED" });
  });

  it("exactamente 5:00 se guarda", async () => {
    record = active({ timerType: "FREE", plannedSec: 7200, finalSec: 300 });
    expect(await service.save(await ready(), { page: 100 })).toMatchObject({ kind: "saved" });
    expect(await sent()).toEqual({ planned: 300, actual: 300, status: "COMPLETED" });
  });

  it("4:59 sin terminar el libro no se guarda", async () => {
    record = active({ timerType: "FREE", plannedSec: 7200, finalSec: 299 });
    expect(await service.save(await ready(), { page: 299 })).toEqual({ kind: "discarded" });
    expect(await db.sessions.count()).toBe(0);
  });

  it("menos de 5 minutos que terminan el libro: planned = 300, actual real, COMPLETED y florece", async () => {
    record = active({ timerType: "FREE", plannedSec: 7200, finalSec: 120 });
    expect(await service.save(await ready(), { page: 300 })).toMatchObject({ kind: "saved", bloomed: true });
    expect(await sent()).toEqual({ planned: 300, actual: 120, status: "COMPLETED" });
  });

  it("el tope de 120 minutos se guarda con planned = actual = 7200", async () => {
    record = active({ timerType: "FREE", plannedSec: 7200, finalSec: 7200 });
    expect(await service.save(await ready(), { page: 100 })).toMatchObject({ kind: "saved" });
    expect(await sent()).toEqual({ planned: 7200, actual: 7200, status: "COMPLETED" });
  });

  it("EPUB libre que llega al 100 % en menos de 5 minutos tambien se guarda", async () => {
    await db.books.put(book({ format_type: "EPUB", total_pages: null, current_page: 0, progress_percentage: 40 }));
    record = active({ timerType: "FREE", plannedSec: 7200, finalSec: 90 });
    progress = { sessionId: SESSION, cfi: "cfi-fin", percentage: 100, excerpt: "", updatedAt: 1 };
    expect(await service.save(await ready())).toMatchObject({ kind: "saved", bloomed: true });
    expect(await sent()).toEqual({ planned: 300, actual: 90, status: "COMPLETED" });
  });

  it("el temporizador sigue enviando lo programado", async () => {
    record = active({ plannedSec: 900, finalSec: 600 });
    await service.save(await ready(), { page: 100 });
    expect(await sent()).toEqual({ planned: 900, actual: 600, status: "COMPLETED" });
  });
});
