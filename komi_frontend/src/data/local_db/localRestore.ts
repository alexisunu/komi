// Aplica una recuperacion en Dexie (SRS 11.4, hidratacion; Fase 5.3). Es ADITIVA, IDEMPOTENTE y
// ATOMICA, y nunca pisa datos locales:
//
//  - Perfil: se crea solo si el dispositivo no tiene uno. Si tiene otro distinto, se aborta sin
//    escribir nada (nunca se mezclan ni se reemplazan perfiles).
//  - Libros: lo que falta se inserta; un libro que ya existe conserva sus datos locales y solo
//    sube su progreso si el del servidor es mayor (monotonico, MAX).
//  - Sesiones: se insertan las que faltan por `id`; las existentes no se tocan.
//  - Charlas: se guardan las que faltan; una semilla local nunca se borra ni se sustituye.
//  - Racha: sube a la del servidor solo si es mayor que la local.
//
// Todo lo traido del servidor entra con `pending_sync = 0`: no se vuelve a subir. Una falla a mitad
// revierte la transaccion entera. El .epub no viaja (se queda en el dispositivo): un libro EPUB
// recuperado aparece sin archivo y se vuelve a elegir como cualquier otro (`missingFiles`).

import { effectiveStreak } from "../../services/localStreak";
import type { KomiDatabase } from "./dexieDatabase";
import { RestoreProfileMismatchError } from "./errors";
import { systemClock, type LocalClock } from "./localBookRepository";
import { META_KEYS } from "./localMetaRepository";
import { defaultStorage, mirrorProfileId, PROFILE_ROW_ID } from "./localProfileRepository";
import { createLocalReflectionRepository } from "./localReflectionRepository";
import type { RestoreBook, RestorePayload, RestoreSession } from "./restoreFormat";
import { formatLocalWallClock } from "./sessionRules";
import { guardStorage } from "./storageGuard";
import type { LocalBook, LocalProfile, LocalSession } from "./types";

export interface RestoreReport {
  profileCreated: boolean;
  booksAdded: number;
  booksAdvanced: number;
  sessionsAdded: number;
  chatsAdded: number;
}

export interface ApplyRestoreOptions {
  clock?: LocalClock;
  /** Copia del `profile_id` en localStorage; por defecto la del navegador. */
  storage?: Pick<Storage, "setItem"> | undefined;
}

function newBook(book: RestoreBook): LocalBook {
  return { ...book, pending_sync: 0 };
}

function newSession(session: RestoreSession): LocalSession {
  return {
    ...session,
    current_page: null,
    progress_percentage: null,
    last_epub_cfi: null,
    extracted_epub_excerpt: null,
    pending_sync: 0,
    sync_rejection: null,
  };
}

/** Sube solo el avance de un libro local si el del servidor es mayor; nada mas se modifica. */
function advancedBook(local: LocalBook, server: RestoreBook): LocalBook | null {
  if (server.progress_percentage <= local.progress_percentage) return null;
  const bloomed = server.progress_percentage >= 100 && (local.status === "ACTIVE" || local.status === "GROWING");
  return {
    ...local,
    progress_percentage: server.progress_percentage,
    current_page: Math.max(local.current_page, server.current_page),
    last_epub_cfi: server.last_epub_cfi ?? local.last_epub_cfi,
    completed_at: local.completed_at ?? server.completed_at,
    status: bloomed ? "BLOOMED" : local.status,
  };
}

export async function applyRestore(
  db: KomiDatabase,
  payload: RestorePayload,
  options: ApplyRestoreOptions = {},
): Promise<RestoreReport> {
  const clock = options.clock ?? systemClock;
  const storage = "storage" in options ? options.storage : defaultStorage();
  const reflections = createLocalReflectionRepository(db, clock);
  const report: RestoreReport = {
    profileCreated: false,
    booksAdded: 0,
    booksAdvanced: 0,
    sessionsAdded: 0,
    chatsAdded: 0,
  };

  await guardStorage(() =>
    db.transaction("rw", [db.profile, db.books, db.sessions, db.reflections, db.meta], async () => {
      const local = await db.profile.get(PROFILE_ROW_ID);
      if (local && local.profile_id !== payload.profile.profile_id) throw new RestoreProfileMismatchError();

      for (const server of payload.books) {
        const existing = await db.books.get(server.id);
        if (!existing) {
          await db.books.add(newBook(server));
          report.booksAdded += 1;
          continue;
        }
        const next = advancedBook(existing, server);
        if (next) {
          await db.books.put(next);
          report.booksAdvanced += 1;
        }
      }

      for (const server of payload.sessions) {
        if (await db.sessions.get(server.id)) continue;
        // Una sesion sin su libro (ni en la respuesta ni en el dispositivo) no tiene donde colgar.
        if (!(await db.books.get(server.book_id))) continue;
        await db.sessions.add(newSession(server));
        report.sessionsAdded += 1;
      }

      for (const chat of payload.chats) {
        const session = await db.sessions.get(chat.session_id);
        if (!session) continue;
        const existing = await db.reflections.get(chat.chat_id);
        await reflections.upsert({
          chat_id: chat.chat_id,
          session_id: chat.session_id,
          book_id: session.book_id,
          turn_count: chat.turn_count,
          is_closed: chat.is_closed,
          // `upsert` deja ganar al valor nuevo: la semilla local, si la hay, manda siempre.
          key_takeaway: existing?.key_takeaway ?? chat.key_takeaway,
        });
        if (!existing) report.chatsAdded += 1;
      }

      if (!local) {
        const stamp = clock.now().toISOString();
        const profile: LocalProfile = {
          id: PROFILE_ROW_ID,
          profile_id: payload.profile.profile_id,
          daily_goal_minutes: payload.profile.daily_goal_minutes,
          preferred_moment: payload.profile.preferred_moment,
          ai_reflection_style: payload.profile.ai_reflection_style,
          theme_mode: null,
          preconfigure_tsukimi: null,
          onboarding_synced: true, // el servidor ya conoce este perfil
          created_at: stamp,
          updated_at: stamp,
        };
        await db.profile.add(profile);
        report.profileCreated = true;
      }

      if (payload.streak) {
        const today = formatLocalWallClock(clock.now()).slice(0, 10);
        const fromServer = effectiveStreak(payload.streak.current, payload.streak.last_valid_session_date, today);
        const stored = (await db.meta.get(META_KEYS.streakCurrent))?.value;
        const localDays = typeof stored === "number" ? stored : 0;
        if (fromServer > localDays) await db.meta.put({ key: META_KEYS.streakCurrent, value: fromServer });
      }
    }),
  );

  // Fuera de la transaccion: si se revirtio, nada se copia a localStorage.
  if (report.profileCreated) mirrorProfileId(payload.profile.profile_id, storage);
  return report;
}
