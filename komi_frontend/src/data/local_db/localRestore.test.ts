import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, fakeClock, uuid } from "../../test/db";
import {
  BOOK_EPUB,
  BOOK_PHYSICAL,
  CHAT_ID,
  RESTORE_PROFILE_ID,
  restoreBody,
  serverBook,
  serverChat,
  serverSession,
  SESSION_EPUB,
  SESSION_PHYSICAL,
} from "../../test/restoreFixture";
import type { KomiDatabase } from "./dexieDatabase";
import { RestoreProfileMismatchError } from "./errors";
import { applyRestore } from "./localRestore";
import { META_KEYS } from "./localMetaRepository";
import { parseRestorePayload, type RestorePayload } from "./restoreFormat";
import type { LocalBook, LocalProfile, LocalSession } from "./types";

let db: KomiDatabase;
const clock = fakeClock("2026-11-06T12:00:00.000Z");

beforeEach(() => {
  db = createTestDb();
});
afterEach(() => db.close());

function payload(over: Record<string, unknown> = {}): RestorePayload {
  const parsed = parseRestorePayload(restoreBody(over));
  if (!parsed) throw new Error("fixture invalida");
  return parsed;
}

const apply = (data: RestorePayload, storage?: Pick<Storage, "setItem">) =>
  applyRestore(db, data, { clock, storage });

async function snapshot() {
  return {
    profile: await db.profile.toArray(),
    books: await db.books.orderBy("id").toArray(),
    sessions: await db.sessions.orderBy("id").toArray(),
    reflections: await db.reflections.orderBy("chat_id").toArray(),
    meta: await db.meta.orderBy("key").toArray(),
  };
}

function localProfile(over: Partial<LocalProfile> = {}): LocalProfile {
  return {
    id: "local",
    profile_id: RESTORE_PROFILE_ID,
    daily_goal_minutes: 10,
    preferred_moment: "MORNING",
    ai_reflection_style: "MEMORY_QUIZ",
    theme_mode: "dark",
    preconfigure_tsukimi: null,
    onboarding_synced: true,
    created_at: "2026-10-01T00:00:00.000Z",
    updated_at: "2026-10-01T00:00:00.000Z",
    ...over,
  };
}

function localBook(over: Partial<LocalBook> = {}): LocalBook {
  return {
    id: BOOK_PHYSICAL,
    title: "Titulo local",
    author: "Autor local",
    format_type: "PHYSICAL",
    sunflower_variant: "AUTUMN",
    status: "FALLOW",
    total_pages: 300,
    current_page: 200,
    progress_percentage: 66.5,
    last_epub_cfi: null,
    created_at: "2026-10-02T00:00:00.000Z",
    completed_at: null,
    updated_at: "2026-11-05T00:00:00.000Z",
    pending_sync: 1,
    ...over,
  };
}

function localSession(over: Partial<LocalSession> = {}): LocalSession {
  return {
    id: SESSION_PHYSICAL,
    book_id: BOOK_PHYSICAL,
    planned_duration_sec: 600,
    actual_duration_sec: 600,
    started_at_local: "2026-11-05T08:00:00",
    session_status: "EARLY_VALID",
    current_page: 200,
    progress_percentage: null,
    last_epub_cfi: null,
    extracted_epub_excerpt: "extracto local",
    progress_delta: 9,
    granted_solar_bonus: true,
    pending_sync: 1,
    sync_rejection: null,
    ...over,
  };
}

describe("dispositivo vacio", () => {
  it("crea el perfil, los libros, las sesiones y la charla", async () => {
    const report = await apply(payload());
    expect(report).toEqual({ profileCreated: true, booksAdded: 2, booksAdvanced: 0, sessionsAdded: 2, chatsAdded: 1 });

    const profile = await db.profile.get("local");
    expect(profile).toMatchObject({
      profile_id: RESTORE_PROFILE_ID,
      daily_goal_minutes: 20,
      preferred_moment: "NIGHT",
      ai_reflection_style: "KEY_SUMMARY",
      theme_mode: null,
      onboarding_synced: true,
    });
    expect(await db.books.count()).toBe(2);
    expect(await db.sessions.count()).toBe(2);
    expect(await db.reflections.get(CHAT_ID)).toMatchObject({
      session_id: SESSION_PHYSICAL,
      book_id: BOOK_PHYSICAL,
      is_closed: true,
      key_takeaway: "Leer es escuchar despacio.",
    });
  });

  it("todo entra sin pendiente de envio: no se vuelve a subir", async () => {
    await apply(payload());
    expect((await db.books.toArray()).every((book) => book.pending_sync === 0)).toBe(true);
    expect((await db.sessions.toArray()).every((session) => session.pending_sync === 0)).toBe(true);
    expect(await db.books.where("pending_sync").equals(1).count()).toBe(0);
  });

  it("conserva los datos del libro tal como los dio el servidor", async () => {
    await apply(payload());
    expect(await db.books.get(BOOK_EPUB)).toEqual({
      id: BOOK_EPUB,
      title: "Libro EPUB",
      author: "Autora",
      format_type: "EPUB",
      sunflower_variant: "CLASSIC",
      status: "ACTIVE",
      total_pages: null,
      current_page: 0,
      progress_percentage: 10,
      last_epub_cfi: "epubcfi(/6/4!/4/2)",
      created_at: "2026-10-01T10:00:00Z",
      completed_at: null,
      updated_at: "2026-11-04T10:00:00Z",
      pending_sync: 0,
    });
  });

  it("las sesiones traen lo del servidor y nada inventado en lo que no se conoce", async () => {
    await apply(payload());
    expect(await db.sessions.get(SESSION_EPUB)).toEqual({
      id: SESSION_EPUB,
      book_id: BOOK_EPUB,
      planned_duration_sec: 900,
      actual_duration_sec: 900,
      started_at_local: "2026-11-04T21:30:00",
      session_status: "COMPLETED",
      progress_delta: 4,
      granted_solar_bonus: false,
      current_page: null,
      progress_percentage: null,
      last_epub_cfi: null,
      extracted_epub_excerpt: null,
      pending_sync: 0,
      sync_rejection: null,
    });
  });

  it("la racha del servidor se guarda como racha actual", async () => {
    clock.set("2026-11-06T12:00:00.000Z"); // un dia despues de la ultima sesion: sigue viva
    await apply(payload());
    expect((await db.meta.get(META_KEYS.streakCurrent))?.value).toBe(3);
  });

  it("una racha de hace mas de un dia ya no cuenta", async () => {
    clock.set("2026-11-09T12:00:00.000Z");
    await apply(payload());
    expect(await db.meta.get(META_KEYS.streakCurrent)).toBeUndefined();
  });

  it("copia el profile_id a localStorage solo si creo el perfil", async () => {
    const storage = { setItem: vi.fn() };
    await apply(payload(), storage);
    expect(storage.setItem).toHaveBeenCalledWith("komi.profile_id", RESTORE_PROFILE_ID);
  });
});

describe("idempotencia", () => {
  it("repetir la recuperacion no cambia nada y no suma nada", async () => {
    await apply(payload());
    const before = await snapshot();
    const second = await apply(payload());
    expect(second).toEqual({ profileCreated: false, booksAdded: 0, booksAdvanced: 0, sessionsAdded: 0, chatsAdded: 0 });
    expect(await snapshot()).toEqual(before);
  });
});

describe("dispositivo con datos: nunca se pisa lo local", () => {
  it("el libro local conserva titulo, autor, variante, estado y pendiente", async () => {
    await db.profile.add(localProfile());
    await db.books.add(localBook());
    await apply(payload());
    expect(await db.books.get(BOOK_PHYSICAL)).toEqual(localBook());
  });

  it("el progreso es monotonico: si el servidor tiene menos, se queda el local", async () => {
    await db.profile.add(localProfile());
    await db.books.add(localBook({ progress_percentage: 66.5 }));
    const report = await apply(payload()); // servidor: 40
    expect(report.booksAdvanced).toBe(0);
    expect((await db.books.get(BOOK_PHYSICAL))?.progress_percentage).toBe(66.5);
  });

  it("si el servidor tiene mas avance, sube el progreso, la pagina y el CFI, y nada mas", async () => {
    await db.profile.add(localProfile());
    await db.books.add(localBook({ progress_percentage: 10, current_page: 30, last_epub_cfi: "cfi-local" }));
    const body = restoreBody({
      books: [serverBook(BOOK_PHYSICAL, { progress_percentage: 55, current_page: 165, last_epub_cfi: "cfi-servidor" })],
      sessions: [],
      chats: [],
    });
    const report = await apply(parseRestorePayload(body) as RestorePayload);
    expect(report.booksAdvanced).toBe(1);
    expect(await db.books.get(BOOK_PHYSICAL)).toEqual(
      localBook({ progress_percentage: 55, current_page: 165, last_epub_cfi: "cfi-servidor" }),
    );
  });

  it("un avance parcial no cambia el estado de un libro activo ni lo marca como completado", async () => {
    await db.profile.add(localProfile());
    await db.books.add(localBook({ status: "ACTIVE", progress_percentage: 10 }));
    const body = restoreBody({
      books: [serverBook(BOOK_PHYSICAL, { progress_percentage: 99.99, completed_at: null })],
      sessions: [],
      chats: [],
    });
    await apply(parseRestorePayload(body) as RestorePayload);
    expect(await db.books.get(BOOK_PHYSICAL)).toMatchObject({
      status: "ACTIVE",
      progress_percentage: 99.99,
      completed_at: null,
    });
  });

  it("la pagina local no baja aunque el servidor traiga mas avance con menos pagina", async () => {
    await db.profile.add(localProfile());
    await db.books.add(localBook({ progress_percentage: 10, current_page: 250 }));
    const body = restoreBody({
      books: [serverBook(BOOK_PHYSICAL, { progress_percentage: 55, current_page: 165 })],
      sessions: [],
      chats: [],
    });
    await apply(parseRestorePayload(body) as RestorePayload);
    expect((await db.books.get(BOOK_PHYSICAL))?.current_page).toBe(250);
  });

  it("un libro activo que el servidor ya florecio, florece; uno en barbecho se queda en barbecho", async () => {
    await db.profile.add(localProfile());
    await db.books.bulkAdd([
      localBook({ id: BOOK_PHYSICAL, status: "ACTIVE", progress_percentage: 50 }),
      localBook({ id: BOOK_EPUB, format_type: "EPUB", total_pages: null, status: "FALLOW", progress_percentage: 50 }),
    ]);
    const bloomed = { progress_percentage: 100, status: "BLOOMED", completed_at: "2026-11-05T10:00:00Z" };
    const body = restoreBody({
      books: [serverBook(BOOK_PHYSICAL, bloomed), serverBook(BOOK_EPUB, { ...bloomed, format_type: "EPUB", total_pages: null })],
      sessions: [],
      chats: [],
    });
    await apply(parseRestorePayload(body) as RestorePayload);
    expect(await db.books.get(BOOK_PHYSICAL)).toMatchObject({ status: "BLOOMED", completed_at: "2026-11-05T10:00:00Z" });
    expect(await db.books.get(BOOK_EPUB)).toMatchObject({ status: "FALLOW", progress_percentage: 100 });
  });

  it("una sesion local con el mismo id no se modifica (ni su extracto ni su pendiente)", async () => {
    await db.profile.add(localProfile());
    await db.books.add(localBook());
    await db.sessions.add(localSession());
    const report = await apply(payload());
    expect(await db.sessions.get(SESSION_PHYSICAL)).toEqual(localSession());
    expect(report.sessionsAdded).toBe(1); // solo la del EPUB
  });

  it("las sesiones locales que el servidor no conoce se quedan", async () => {
    await db.profile.add(localProfile());
    await db.books.add(localBook());
    await db.sessions.add(localSession({ id: uuid(999) }));
    await apply(payload());
    expect(await db.sessions.get(uuid(999))).toEqual(localSession({ id: uuid(999) }));
  });

  it("el perfil local no se toca: ni meta, ni estilo, ni tema", async () => {
    await db.profile.add(localProfile());
    await apply(payload());
    expect(await db.profile.get("local")).toEqual(localProfile());
  });

  it("una semilla local nunca se sustituye por la del servidor", async () => {
    await db.profile.add(localProfile());
    await db.books.add(localBook());
    await db.sessions.add(localSession());
    await db.reflections.add({
      chat_id: CHAT_ID,
      session_id: SESSION_PHYSICAL,
      book_id: BOOK_PHYSICAL,
      turn_count: 5,
      is_closed: true,
      key_takeaway: "Mi frase local.",
      updated_at: "2026-11-05T00:00:00.000Z",
    });
    const report = await apply(payload());
    expect((await db.reflections.get(CHAT_ID))?.key_takeaway).toBe("Mi frase local.");
    expect(report.chatsAdded).toBe(0);
  });

  it("una charla local cerrada no se reabre", async () => {
    await db.profile.add(localProfile());
    await db.books.add(localBook());
    await db.sessions.add(localSession());
    await db.reflections.add({
      chat_id: CHAT_ID,
      session_id: SESSION_PHYSICAL,
      book_id: BOOK_PHYSICAL,
      turn_count: 5,
      is_closed: true,
      key_takeaway: null,
      updated_at: "2026-11-05T00:00:00.000Z",
    });
    const body = restoreBody({ chats: [serverChat(CHAT_ID, SESSION_PHYSICAL, { is_closed: false, turn_count: 2, key_takeaway: null })] });
    await apply(parseRestorePayload(body) as RestorePayload);
    expect(await db.reflections.get(CHAT_ID)).toMatchObject({ is_closed: true, turn_count: 5 });
  });

  it("la racha local mayor no baja a la del servidor", async () => {
    clock.set("2026-11-06T12:00:00.000Z");
    await db.meta.put({ key: META_KEYS.streakCurrent, value: 9 });
    await apply(payload());
    expect((await db.meta.get(META_KEYS.streakCurrent))?.value).toBe(9);
  });

  it("la racha del servidor sube la local si es mayor", async () => {
    clock.set("2026-11-06T12:00:00.000Z");
    await db.meta.put({ key: META_KEYS.streakCurrent, value: 1 });
    await apply(payload());
    expect((await db.meta.get(META_KEYS.streakCurrent))?.value).toBe(3);
  });

  it("no copia el profile_id a localStorage si el perfil ya existia", async () => {
    await db.profile.add(localProfile());
    const storage = { setItem: vi.fn() };
    await apply(payload(), storage);
    expect(storage.setItem).not.toHaveBeenCalled();
  });
});

describe("otro perfil en el dispositivo", () => {
  it("se niega sin escribir nada", async () => {
    await db.profile.add(localProfile({ profile_id: uuid(555) }));
    await db.books.add(localBook());
    const before = await snapshot();
    await expect(apply(payload())).rejects.toBeInstanceOf(RestoreProfileMismatchError);
    expect(await snapshot()).toEqual(before);
  });
});

describe("atomicidad y casos raros", () => {
  it("una falla a mitad revierte TODO, incluido el perfil", async () => {
    vi.spyOn(db.reflections, "put").mockRejectedValue(new Error("falla de disco"));
    vi.spyOn(db.reflections, "add").mockRejectedValue(new Error("falla de disco"));
    const storage = { setItem: vi.fn() };
    await expect(apply(payload(), storage)).rejects.toThrow();
    expect(await db.profile.count()).toBe(0);
    expect(await db.books.count()).toBe(0);
    expect(await db.sessions.count()).toBe(0);
    expect(await db.meta.count()).toBe(0);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("una sesion cuyo libro no existe en ningun lado se omite", async () => {
    const body = restoreBody({
      books: [serverBook(BOOK_PHYSICAL)],
      sessions: [serverSession(SESSION_PHYSICAL, BOOK_PHYSICAL), serverSession(SESSION_EPUB, uuid(777))],
      chats: [],
    });
    const report = await apply(parseRestorePayload(body) as RestorePayload);
    expect(report.sessionsAdded).toBe(1);
    expect(await db.sessions.get(SESSION_EPUB)).toBeUndefined();
  });

  it("una sesion se cuelga de un libro que ya estaba en el dispositivo", async () => {
    await db.profile.add(localProfile());
    await db.books.add(localBook({ id: uuid(777) }));
    const body = restoreBody({ books: [], sessions: [serverSession(SESSION_EPUB, uuid(777))], chats: [] });
    const report = await apply(parseRestorePayload(body) as RestorePayload);
    expect(report.sessionsAdded).toBe(1);
  });

  it("una charla cuya sesion no se pudo guardar se omite", async () => {
    const body = restoreBody({
      sessions: [],
      chats: [serverChat(CHAT_ID, SESSION_PHYSICAL)],
    });
    const report = await apply(parseRestorePayload(body) as RestorePayload);
    expect(report.chatsAdded).toBe(0);
    expect(await db.reflections.count()).toBe(0);
  });

  it("sin racha en la respuesta no se escribe la racha", async () => {
    await apply(payload({ streak: null }));
    expect(await db.meta.get(META_KEYS.streakCurrent)).toBeUndefined();
  });
});
