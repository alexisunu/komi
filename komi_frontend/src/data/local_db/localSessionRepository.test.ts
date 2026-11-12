import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, fakeClock, uuid, type FakeClock } from "../../test/db";
import type { KomiDatabase } from "./dexieDatabase";
import {
  BookNotFoundError,
  InvalidSessionError,
  SessionConflictError,
  StorageQuotaError,
  StorageUnavailableError,
} from "./errors";
import { createLocalBookRepository, type LocalBookRepository } from "./localBookRepository";
import {
  createLocalSessionRepository,
  type LocalSessionRepository,
} from "./localSessionRepository";
import type { CompleteSessionInput } from "./sessionRules";
import { KomiDatabase as RealDatabase } from "./dexieDatabase";
import type { LocalBook } from "./types";

let db: KomiDatabase;
let clock: FakeClock;
let books: LocalBookRepository;
let sessions: LocalSessionRepository;

beforeEach(() => {
  db = createTestDb();
  clock = fakeClock();
  books = createLocalBookRepository(db, clock);
  sessions = createLocalSessionRepository(db, clock);
});
afterEach(() => {
  vi.restoreAllMocks();
  db.close();
});

let sessionCounter = 0;
function session(bookId: string, overrides: Partial<CompleteSessionInput> = {}): CompleteSessionInput {
  sessionCounter += 1;
  return {
    id: uuid(10_000 + sessionCounter),
    book_id: bookId,
    planned_duration_sec: 900,
    actual_duration_sec: 900,
    started_at_local: "2026-11-05T21:30:00",
    session_status: "COMPLETED",
    current_page: 30,
    ...overrides,
  };
}

async function physicalBook(overrides: Partial<LocalBook> = {}): Promise<LocalBook> {
  const book = await books.createBook({
    title: "Kokoro",
    author: "Natsume Soseki",
    format_type: "PHYSICAL",
    total_pages: 264,
  });
  await books.markBooksSynced([{ id: book.id, updated_at: book.updated_at }]);
  const synced = (await books.getBook(book.id)) as LocalBook;
  if (Object.keys(overrides).length > 0) await db.books.put({ ...synced, ...overrides });
  return (await books.getBook(book.id)) as LocalBook;
}

async function epubBook(overrides: Partial<LocalBook> = {}): Promise<LocalBook> {
  const book = await books.createBook({ title: "Snow Country", author: "Kawabata", format_type: "EPUB" });
  await books.markBooksSynced([{ id: book.id, updated_at: book.updated_at }]);
  if (Object.keys(overrides).length > 0) await db.books.put({ ...book, pending_sync: 0, ...overrides });
  return (await books.getBook(book.id)) as LocalBook;
}

describe("completeSession: sesion y libro en una sola transaccion", () => {
  it("guarda la sesion y avanza el libro (fisico)", async () => {
    const book = await physicalBook();
    clock.advance(3_600_000);
    const result = await sessions.completeSession(session(book.id, { current_page: 100 }));

    expect(result.created).toBe(true);
    expect(result.session).toMatchObject({
      book_id: book.id,
      session_status: "COMPLETED",
      current_page: 100,
      progress_percentage: null,
      progress_delta: 37.87,
      granted_solar_bonus: false,
      pending_sync: 1,
      started_at_local: "2026-11-05T21:30:00",
    });
    expect(result.book).toMatchObject({
      progress_percentage: 37.87,
      current_page: 100,
      pending_sync: 1,
      updated_at: "2026-11-05T11:00:00.000Z",
    });
    expect(await books.getBook(book.id)).toEqual(result.book);
    expect(await sessions.getSession(result.session.id)).toEqual(result.session);
  });

  it("si falla al guardar la sesion, el libro tampoco cambia (reversion de la transaccion)", async () => {
    const book = await physicalBook();
    vi.spyOn(db.sessions, "add").mockRejectedValueOnce(new Error("fallo simulado"));

    await expect(sessions.completeSession(session(book.id, { current_page: 100 }))).rejects.toThrow(
      "fallo simulado",
    );
    expect(await books.getBook(book.id)).toEqual(book);
    expect(await db.sessions.count()).toBe(0);
  });

  it("falla con BookNotFoundError y no escribe nada si el libro no existe", async () => {
    await expect(sessions.completeSession(session(uuid(404)))).rejects.toBeInstanceOf(BookNotFoundError);
    expect(await db.sessions.count()).toBe(0);
  });

  it("una entrada invalida rechaza la promesa y no escribe", async () => {
    const book = await physicalBook();
    await expect(
      sessions.completeSession(session(book.id, { started_at_local: "2026-11-05T21:30:00Z" })),
    ).rejects.toBeInstanceOf(InvalidSessionError);
    expect(await db.sessions.count()).toBe(0);
  });

  it("menos de 5 minutos que no terminan el libro se rechazan sin guardar nada", async () => {
    const book = await physicalBook();
    await expect(
      sessions.completeSession(session(book.id, { actual_duration_sec: 100 })),
    ).rejects.toMatchObject({ code: "duration_out_of_range" });
    expect(await db.sessions.count()).toBe(0);
    expect(await books.getBook(book.id)).toEqual(book);
  });

  it("florece el libro al llegar a la ultima pagina", async () => {
    const book = await physicalBook({ current_page: 250, progress_percentage: 94.69 });
    clock.advance(1000);
    const result = await sessions.completeSession(session(book.id, { current_page: 264 }));
    expect(result.book).toMatchObject({
      status: "BLOOMED",
      progress_percentage: 100,
      completed_at: "2026-11-05T10:00:01.000Z",
    });
  });

  it("un libro en barbecho o ya florecido rechaza lecturas validas", async () => {
    const fallow = await physicalBook({ status: "FALLOW" });
    await expect(sessions.completeSession(session(fallow.id))).rejects.toBeInstanceOf(
      SessionConflictError,
    );
    const bloomed = await physicalBook({ status: "BLOOMED", progress_percentage: 100, current_page: 264 });
    await expect(sessions.completeSession(session(bloomed.id))).rejects.toMatchObject({
      code: "book_bloomed",
    });
  });
});

describe("progreso monotonico", () => {
  it("una lectura que retrocede no baja el progreso ni la pagina y no toca el libro", async () => {
    const book = await physicalBook({ current_page: 120, progress_percentage: 45.45 });
    clock.advance(3_600_000);

    const result = await sessions.completeSession(session(book.id, { current_page: 100 }));
    expect(result.book).toEqual(book); // updated_at, pending_sync y todo igual
    expect(result.book.pending_sync).toBe(0);
    expect(result.session.progress_delta).toBe(0);
    expect(result.session.current_page).toBe(100); // se registra lo que dijo el lector
    expect(result.session.granted_solar_bonus).toBe(true); // avance 0 califica
  });

  it("nunca baja con cualquier orden de sesiones", async () => {
    const book = await physicalBook();
    let max = 0;
    for (const page of [50, 10, 200, 60, 199, 0, 264 - 1]) {
      const { book: after } = await sessions.completeSession(session(book.id, { current_page: page }));
      max = Math.max(max, after.progress_percentage);
      expect(after.progress_percentage).toBe(max);
    }
    expect(max).toBe(99.62); // 263/264
  });

  it("current_page solo sube", async () => {
    const book = await physicalBook();
    await sessions.completeSession(session(book.id, { current_page: 150 }));
    const { book: after } = await sessions.completeSession(session(book.id, { current_page: 20 }));
    expect(after.current_page).toBe(150);
  });
});

describe("progreso fisico truncado, no redondeado", () => {
  it("2 de 3 paginas es 66.66, no 66.67", async () => {
    const book = await books.createBook({
      title: "Corto",
      author: "A",
      format_type: "PHYSICAL",
      total_pages: 3,
    });
    const { book: after } = await sessions.completeSession(session(book.id, { current_page: 2 }));
    expect(after.progress_percentage).toBe(66.66);
  });

  it("la penultima pagina de un libro largo no marca 100%", async () => {
    const book = await books.createBook({
      title: "Largo",
      author: "A",
      format_type: "PHYSICAL",
      total_pages: 100_000,
    });
    const { book: after } = await sessions.completeSession(session(book.id, { current_page: 99_999 }));
    expect(after.progress_percentage).toBe(99.99);
    expect(after.status).toBe("ACTIVE");
  });
});

describe("EPUB: current_page y last_epub_cfi solo avanzan con el progreso", () => {
  const read = (bookId: string, progress: number, cfi: string, extra: Partial<CompleteSessionInput> = {}) =>
    session(bookId, {
      current_page: undefined,
      progress_percentage: progress,
      last_epub_cfi: cfi,
      ...extra,
    });

  it("avanza el progreso y el CFI", async () => {
    const book = await epubBook();
    const { book: after } = await sessions.completeSession(read(book.id, 40.555, "cfi-40"));
    expect(after).toMatchObject({ progress_percentage: 40.55, last_epub_cfi: "cfi-40" });
  });

  it("una lectura que retrocede no cambia el CFI, el progreso ni updated_at", async () => {
    const book = await epubBook({ progress_percentage: 50, last_epub_cfi: "cfi-50" });
    clock.advance(3_600_000);
    const result = await sessions.completeSession(read(book.id, 30, "cfi-30"));
    expect(result.book).toEqual(book);
    expect(result.book.last_epub_cfi).toBe("cfi-50");
    expect(result.session.progress_percentage).toBe(30); // la sesion conserva lo informado
    expect(result.session.last_epub_cfi).toBe("cfi-30");
  });

  it("mismo progreso con otro CFI si lo actualiza (igual que el servidor)", async () => {
    const book = await epubBook({ progress_percentage: 50, last_epub_cfi: "cfi-a" });
    clock.advance(1000);
    const { book: after } = await sessions.completeSession(read(book.id, 50, "cfi-b"));
    expect(after.last_epub_cfi).toBe("cfi-b");
    expect(after.updated_at).toBe("2026-11-05T10:00:01.000Z");
  });

  it("mismo progreso y mismo CFI no son un cambio", async () => {
    const book = await epubBook({ progress_percentage: 50, last_epub_cfi: "cfi-a" });
    clock.advance(1000);
    const { book: after } = await sessions.completeSession(read(book.id, 50, "cfi-a"));
    expect(after).toEqual(book);
  });

  it("EPUB nunca recibe bono solar", async () => {
    const book = await epubBook({ progress_percentage: 50, last_epub_cfi: "cfi-a" });
    const { session: saved } = await sessions.completeSession(read(book.id, 50.2, "cfi-b"));
    expect(saved.granted_solar_bonus).toBe(false);
  });
});

describe("sesion invalidada (periodo de gracia vencido)", () => {
  it("se guarda sin tocar el libro y sin progreso", async () => {
    const book = await physicalBook({ current_page: 120, progress_percentage: 45.45 });
    clock.advance(3_600_000);
    const result = await sessions.completeSession(
      session(book.id, {
        session_status: "INVALIDATED_GRACE_EXPIRED",
        actual_duration_sec: 20,
        current_page: 250,
      }),
    );
    expect(result.created).toBe(true);
    expect(result.book).toEqual(book);
    expect(result.session).toMatchObject({
      session_status: "INVALIDATED_GRACE_EXPIRED",
      current_page: null,
      progress_percentage: null,
      progress_delta: 0,
      granted_solar_bonus: false,
    });
  });
});

describe("idempotencia por UUID", () => {
  it("repetir la misma sesion no duplica, no sobrescribe y no toca el libro", async () => {
    const book = await physicalBook();
    const input = session(book.id, { current_page: 100 });
    const first = await sessions.completeSession(input);
    clock.advance(3_600_000);

    const again = await sessions.completeSession({ ...input, current_page: 250, actual_duration_sec: 500 });
    expect(again.created).toBe(false);
    expect(again.session).toEqual(first.session);
    expect(again.book).toEqual(first.book);
    expect(await db.sessions.count()).toBe(1);
    expect((await books.getBook(book.id))?.updated_at).toBe(first.book.updated_at);
  });

  it("5 llamadas simultaneas con el mismo UUID crean una sola sesion", async () => {
    const book = await physicalBook();
    const input = session(book.id, { current_page: 100 });
    const results = await Promise.all(Array.from({ length: 5 }, () => sessions.completeSession(input)));
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(await db.sessions.count()).toBe(1);
    expect((await books.getBook(book.id))?.progress_percentage).toBe(37.87);
  });
});

describe("concurrencia", () => {
  it("20 sesiones simultaneas de un mismo libro: se guardan todas y el progreso es el maximo", async () => {
    const book = await physicalBook();
    const pages = Array.from({ length: 20 }, (_, i) => ((i * 37) % 250) + 1);
    const results = await Promise.all(
      pages.map((page) => sessions.completeSession(session(book.id, { current_page: page }))),
    );

    expect(results.every((r) => r.created)).toBe(true);
    expect(await db.sessions.count()).toBe(20);
    const after = (await books.getBook(book.id)) as LocalBook;
    const maxPage = Math.max(...pages);
    expect(after.current_page).toBe(maxPage);
    expect(after.progress_percentage).toBe(Math.floor((maxPage * 10_000) / 264) / 100);
  });

  it("libros distintos en paralelo no se mezclan", async () => {
    const a = await physicalBook();
    const bBook = await books.createBook({ title: "B", author: "B", format_type: "PHYSICAL", total_pages: 100 });
    await Promise.all([
      sessions.completeSession(session(a.id, { current_page: 132 })),
      sessions.completeSession(session(bBook.id, { current_page: 10 })),
      sessions.completeSession(session(a.id, { current_page: 66 })),
    ]);
    expect((await books.getBook(a.id))?.progress_percentage).toBe(50);
    expect((await books.getBook(bBook.id))?.progress_percentage).toBe(10);
  });
});

describe("hora local sin zona", () => {
  it("guarda y devuelve los digitos del reloj tal cual, sin convertir", async () => {
    const book = await physicalBook();
    const { session: saved } = await sessions.completeSession(
      session(book.id, { started_at_local: "2026-11-05T23:50:00", current_page: 10 }),
    );
    expect(saved.started_at_local).toBe("2026-11-05T23:50:00");
    expect((await sessions.getSession(saved.id))?.started_at_local).toBe("2026-11-05T23:50:00");
  });

  it("una lectura que cruza la medianoche queda en el dia en que empezo", async () => {
    const book = await physicalBook();
    await sessions.completeSession(session(book.id, { started_at_local: "2026-11-05T23:50:00", current_page: 10 }));
    await sessions.completeSession(session(book.id, { started_at_local: "2026-11-06T00:05:00", current_page: 20 }));
    const day5 = await sessions.listSessionsBetween("2026-11-05T00:00:00", "2026-11-05T23:59:59");
    expect(day5.map((s) => s.started_at_local)).toEqual(["2026-11-05T23:50:00"]);
  });
});

describe("extracto del EPUB", () => {
  const epubSession = (bookId: string, excerpt: string | null | undefined, extra: Partial<CompleteSessionInput> = {}) =>
    session(bookId, {
      current_page: undefined,
      progress_percentage: 20,
      last_epub_cfi: "cfi-20",
      extracted_epub_excerpt: excerpt,
      ...extra,
    });

  it("se guarda en una sesion EPUB valida", async () => {
    const book = await epubBook();
    const { session: saved } = await sessions.completeSession(epubSession(book.id, "La luz entraba."));
    expect(saved.extracted_epub_excerpt).toBe("La luz entraba.");
  });

  it("no se guarda si esta vacio, si la sesion es invalidada, ni en libros fisicos", async () => {
    const book = await epubBook();
    expect((await sessions.completeSession(epubSession(book.id, ""))).session.extracted_epub_excerpt).toBeNull();
    expect((await sessions.completeSession(epubSession(book.id, null))).session.extracted_epub_excerpt).toBeNull();
    const invalid = await sessions.completeSession(
      epubSession(book.id, "texto", { session_status: "INVALIDATED_GRACE_EXPIRED", actual_duration_sec: 5 }),
    );
    expect(invalid.session.extracted_epub_excerpt).toBeNull();

    const physical = await physicalBook();
    const phys = await sessions.completeSession(session(physical.id, { extracted_epub_excerpt: "texto" }));
    expect(phys.session.extracted_epub_excerpt).toBeNull();
  });

  it("se anula al sincronizar la sesion, y la marca de pendiente se limpia", async () => {
    const book = await epubBook();
    const { session: saved } = await sessions.completeSession(epubSession(book.id, "Fragmento largo..."));
    expect((await sessions.listPendingSessions()).map((s) => s.id)).toEqual([saved.id]);

    await sessions.markSessionsSynced([saved.id]);
    const after = await sessions.getSession(saved.id);
    expect(after?.extracted_epub_excerpt).toBeNull();
    expect(after?.pending_sync).toBe(0);
    expect(await sessions.listPendingSessions()).toEqual([]);
    // El resto de la sesion se conserva.
    expect(after).toMatchObject({ progress_percentage: 20, last_epub_cfi: "cfi-20", book_id: book.id });
  });

  it("no se anula mientras la sesion no se haya sincronizado", async () => {
    const book = await epubBook();
    const { session: saved } = await sessions.completeSession(epubSession(book.id, "Pendiente"));
    await sessions.markSessionsSynced([uuid(404)]); // otro id
    expect((await sessions.getSession(saved.id))?.extracted_epub_excerpt).toBe("Pendiente");
  });

  it("marcar sincronizado dos veces es inofensivo", async () => {
    const book = await epubBook();
    const { session: saved } = await sessions.completeSession(epubSession(book.id, "Texto"));
    await sessions.markSessionsSynced([saved.id]);
    const once = await sessions.getSession(saved.id);
    await sessions.markSessionsSynced([saved.id]);
    expect(await sessions.getSession(saved.id)).toEqual(once);
  });
});

describe("consultas", () => {
  it("listSessionsForBook devuelve solo las del libro, en orden cronologico", async () => {
    const a = await physicalBook();
    const other = await books.createBook({ title: "B", author: "B", format_type: "PHYSICAL", total_pages: 100 });
    await sessions.completeSession(session(a.id, { started_at_local: "2026-11-05T21:00:00", current_page: 30 }));
    await sessions.completeSession(session(a.id, { started_at_local: "2026-11-03T08:00:00", current_page: 10 }));
    await sessions.completeSession(session(other.id, { started_at_local: "2026-11-04T08:00:00", current_page: 5 }));

    const list = await sessions.listSessionsForBook(a.id);
    expect(list.map((s) => s.started_at_local)).toEqual(["2026-11-03T08:00:00", "2026-11-05T21:00:00"]);
  });

  it("listSessionsBetween incluye ambos extremos del rango", async () => {
    const book = await physicalBook();
    for (const [i, at] of ["2026-11-04T23:59:59", "2026-11-05T00:00:00", "2026-11-05T12:00:00", "2026-11-05T23:59:59", "2026-11-06T00:00:00"].entries()) {
      await sessions.completeSession(session(book.id, { started_at_local: at, current_page: 10 + i }));
    }
    const day = await sessions.listSessionsBetween("2026-11-05T00:00:00", "2026-11-05T23:59:59");
    expect(day.map((x) => x.started_at_local)).toEqual([
      "2026-11-05T00:00:00",
      "2026-11-05T12:00:00",
      "2026-11-05T23:59:59",
    ]);
  });

  it("listPendingSessions ordena por hora local de inicio", async () => {
    const book = await physicalBook();
    await sessions.completeSession(session(book.id, { started_at_local: "2026-11-05T09:00:00", current_page: 20 }));
    await sessions.completeSession(session(book.id, { started_at_local: "2026-11-04T09:00:00", current_page: 10 }));
    expect((await sessions.listPendingSessions()).map((s) => s.started_at_local)).toEqual([
      "2026-11-04T09:00:00",
      "2026-11-05T09:00:00",
    ]);
  });
});

describe("almacenamiento con cuota llena o no disponible", () => {
  it("cuota llena: StorageQuotaError y el libro no queda a medias", async () => {
    const book = await physicalBook();
    vi.spyOn(db.sessions, "add").mockRejectedValueOnce(new DOMException("lleno", "QuotaExceededError"));

    const failure = await sessions
      .completeSession(session(book.id, { current_page: 100 }))
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(StorageQuotaError);
    expect((failure as StorageQuotaError).code).toBe("storage_quota");
    expect(await books.getBook(book.id)).toEqual(book);
    expect(await db.sessions.count()).toBe(0);
  });

  it("cuota llena al crear un libro", async () => {
    vi.spyOn(db.books, "add").mockRejectedValueOnce(new DOMException("lleno", "QuotaExceededError"));
    await expect(
      books.createBook({ title: "A", author: "B", format_type: "EPUB" }),
    ).rejects.toBeInstanceOf(StorageQuotaError);
  });

  it("IndexedDB inexistente: StorageUnavailableError en cada operacion", async () => {
    const broken = new RealDatabase("sin-indexeddb");
    const brokenBooks = createLocalBookRepository(broken, clock);
    const brokenSessions = createLocalSessionRepository(broken, clock);
    await expect(brokenBooks.listBooks()).rejects.toBeInstanceOf(StorageUnavailableError);
    await expect(
      brokenBooks.createBook({ title: "A", author: "B", format_type: "EPUB" }),
    ).rejects.toBeInstanceOf(StorageUnavailableError);
    await expect(brokenSessions.completeSession(session(uuid(1)))).rejects.toBeInstanceOf(
      StorageUnavailableError,
    );
    await expect(brokenSessions.listPendingSessions()).rejects.toBeInstanceOf(StorageUnavailableError);
  });

  it("los errores de validacion no se confunden con errores de almacenamiento", async () => {
    await expect(sessions.completeSession(session(uuid(404)))).rejects.toBeInstanceOf(BookNotFoundError);
  });

  it("un error desconocido se propaga sin traducir", async () => {
    const book = await physicalBook();
    vi.spyOn(db.sessions, "add").mockRejectedValueOnce(new TypeError("raro"));
    await expect(sessions.completeSession(session(book.id))).rejects.toBeInstanceOf(TypeError);
  });
});
