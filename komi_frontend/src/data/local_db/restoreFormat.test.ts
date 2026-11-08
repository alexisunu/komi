import { describe, expect, it } from "vitest";
import { uuid } from "../../test/db";
import {
  BOOK_EPUB,
  BOOK_PHYSICAL,
  CHAT_ID,
  RESTORE_PROFILE_ID,
  restoreBody,
  serverBook,
  serverChat,
  serverSession,
} from "../../test/restoreFixture";
import { parseRestorePayload } from "./restoreFormat";

describe("parseRestorePayload", () => {
  it("acepta la respuesta real del servidor y la normaliza", () => {
    const payload = parseRestorePayload(restoreBody());
    expect(payload).not.toBeNull();
    expect(payload?.profile).toEqual({
      profile_id: RESTORE_PROFILE_ID,
      daily_goal_minutes: 20,
      preferred_moment: "NIGHT",
      ai_reflection_style: "KEY_SUMMARY",
    });
    expect(payload?.streak).toEqual({ current: 3, longest: 5, last_valid_session_date: "2026-11-05" });
    expect(payload?.books.map((book) => book.id)).toEqual([BOOK_PHYSICAL, BOOK_EPUB]);
    expect(payload?.sessions).toHaveLength(2);
    expect(payload?.chats).toEqual([
      { chat_id: CHAT_ID, session_id: uuid(911), turn_count: 5, is_closed: true, key_takeaway: "Leer es escuchar despacio." },
    ]);
  });

  it("ignora los campos de mas: la etapa del girasol y los mensajes de la charla", () => {
    const payload = parseRestorePayload(restoreBody());
    expect(payload?.books[0]).not.toHaveProperty("growth_stage");
    expect(payload?.chats[0]).not.toHaveProperty("messages");
  });

  it("un perfil sin libros ni sesiones ni charlas es valido", () => {
    const payload = parseRestorePayload(restoreBody({ books: [], sessions: [], chats: [] }));
    expect(payload?.books).toEqual([]);
  });

  it("la racha ausente o nula se acepta como sin dato", () => {
    expect(parseRestorePayload(restoreBody({ streak: null }))?.streak).toBeNull();
    const without = restoreBody();
    delete without["streak"];
    expect(parseRestorePayload(without)?.streak).toBeNull();
  });

  it("pasa a minusculas los UUID", () => {
    // Con letras hexadecimales: un UUID solo de digitos no distingue mayusculas de minusculas.
    const profile = "abcdef01-2345-4678-89ab-cdef01234567";
    const book = "abcdef02-2345-4678-89ab-cdef01234567";
    const session = "abcdef03-2345-4678-89ab-cdef01234567";
    const chat = "abcdef04-2345-4678-89ab-cdef01234567";
    const upper = restoreBody({
      profile: { ...(restoreBody()["profile"] as object), profile_id: profile.toUpperCase() },
      books: [serverBook(book.toUpperCase())],
      sessions: [serverSession(session.toUpperCase(), book.toUpperCase())],
      chats: [serverChat(chat.toUpperCase(), session.toUpperCase())],
    });
    const payload = parseRestorePayload(upper);
    expect(payload?.profile.profile_id).toBe(profile);
    expect(payload?.books[0]?.id).toBe(book);
    expect(payload?.sessions[0]).toMatchObject({ id: session, book_id: book });
    expect(payload?.chats[0]).toMatchObject({ chat_id: chat, session_id: session });
  });

  const invalid: Array<[string, unknown]> = [
    ["no es un objeto", "texto"],
    ["es una lista", []],
    ["falta el perfil", restoreBody({ profile: undefined })],
    ["perfil con id que no es UUID", restoreBody({ profile: { ...(restoreBody()["profile"] as object), profile_id: "x" } })],
    ["perfil con meta fuera de rango", restoreBody({ profile: { ...(restoreBody()["profile"] as object), daily_goal_minutes: 0 } })],
    ["perfil con momento desconocido", restoreBody({ profile: { ...(restoreBody()["profile"] as object), preferred_moment: "X" } })],
    ["perfil con estilo desconocido", restoreBody({ profile: { ...(restoreBody()["profile"] as object), ai_reflection_style: "X" } })],
    ["racha con valor negativo", restoreBody({ streak: { current: -1, longest: 0, last_valid_session_date: null } })],
    ["racha que no es objeto", restoreBody({ streak: 3 })],
    ["racha con fecha que no es texto", restoreBody({ streak: { current: 1, longest: 1, last_valid_session_date: 20261105 } })],
    ["racha con valores decimales", restoreBody({ streak: { current: 1.5, longest: 2, last_valid_session_date: null } })],
    ["libros que no es lista", restoreBody({ books: {} })],
    ["libro con id invalido", restoreBody({ books: [serverBook("no-uuid")] })],
    ["libro sin titulo", restoreBody({ books: [serverBook(BOOK_PHYSICAL, { title: "   " })] })],
    ["libro con titulo larguisimo", restoreBody({ books: [serverBook(BOOK_PHYSICAL, { title: "x".repeat(256) })] })],
    ["libro con formato desconocido", restoreBody({ books: [serverBook(BOOK_PHYSICAL, { format_type: "PDF" })] })],
    ["libro con variante desconocida", restoreBody({ books: [serverBook(BOOK_PHYSICAL, { sunflower_variant: "X" })] })],
    ["libro con estado desconocido", restoreBody({ books: [serverBook(BOOK_PHYSICAL, { status: "X" })] })],
    ["libro con progreso mayor que 100", restoreBody({ books: [serverBook(BOOK_PHYSICAL, { progress_percentage: 100.5 })] })],
    ["libro con progreso negativo", restoreBody({ books: [serverBook(BOOK_PHYSICAL, { progress_percentage: -1 })] })],
    ["libro con progreso como texto", restoreBody({ books: [serverBook(BOOK_PHYSICAL, { progress_percentage: "40.00" })] })],
    ["libro con paginas en cero", restoreBody({ books: [serverBook(BOOK_PHYSICAL, { total_pages: 0 })] })],
    ["libro con pagina actual negativa", restoreBody({ books: [serverBook(BOOK_PHYSICAL, { current_page: -1 })] })],
    ["libro con CFI numerico", restoreBody({ books: [serverBook(BOOK_PHYSICAL, { last_epub_cfi: 3 })] })],
    ["libro con fecha invalida", restoreBody({ books: [serverBook(BOOK_PHYSICAL, { updated_at: "ayer" })] })],
    ["libro con completed_at invalido", restoreBody({ books: [serverBook(BOOK_PHYSICAL, { completed_at: "ayer" })] })],
    ["sesion con id invalido", restoreBody({ sessions: [serverSession("x", BOOK_PHYSICAL)] })],
    ["sesion con libro invalido", restoreBody({ sessions: [serverSession(uuid(911), "x")] })],
    ["sesion con duracion negativa", restoreBody({ sessions: [serverSession(uuid(911), BOOK_PHYSICAL, { actual_duration_sec: -1 })] })],
    ["sesion con hora con zona", restoreBody({ sessions: [serverSession(uuid(911), BOOK_PHYSICAL, { started_at_local: "2026-11-04T21:30:00Z" })] })],
    ["sesion con estado desconocido", restoreBody({ sessions: [serverSession(uuid(911), BOOK_PHYSICAL, { session_status: "X" })] })],
    ["sesion con delta no numerico", restoreBody({ sessions: [serverSession(uuid(911), BOOK_PHYSICAL, { progress_delta: "4" })] })],
    ["sesion con bono no booleano", restoreBody({ sessions: [serverSession(uuid(911), BOOK_PHYSICAL, { granted_solar_bonus: 1 })] })],
    ["charla con id invalido", restoreBody({ chats: [serverChat("x", uuid(911))] })],
    ["charla con turno 6", restoreBody({ chats: [serverChat(CHAT_ID, uuid(911), { turn_count: 6 })] })],
    ["charla con is_closed no booleano", restoreBody({ chats: [serverChat(CHAT_ID, uuid(911), { is_closed: "si" })] })],
    ["charla con semilla numerica", restoreBody({ chats: [serverChat(CHAT_ID, uuid(911), { key_takeaway: 7 })] })],
  ];

  it.each(invalid)("descarta toda la respuesta si %s", (_name, data) => {
    expect(parseRestorePayload(data)).toBeNull();
  });

  it("basta un elemento malo entre muchos buenos para descartarlo todo", () => {
    const body = restoreBody({ books: [serverBook(BOOK_PHYSICAL), serverBook(BOOK_EPUB, { status: "X" })] });
    expect(parseRestorePayload(body)).toBeNull();
  });
});
