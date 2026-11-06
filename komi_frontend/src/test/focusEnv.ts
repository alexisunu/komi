// Entorno falso para el temporizador: reloj manual, documento con visibilitychange, almacen en
// memoria y registro de sesiones invalidadas. Sin Dexie ni timers reales.

import {
  createFocusVisibilityService,
  type ActiveSessionStore,
  type FocusDocument,
  type FocusWindow,
} from "../services/focusVisibilityService";
import type { ActiveSession } from "../services/focusSessionMachine";

export const SESSION_ID = "11111111-1111-4111-8111-111111111111";
export const BOOK_ID = "22222222-2222-4222-8222-222222222222";
export const T0 = 1_800_000_000_000;

export function createFocusEnv(start = T0) {
  let current = start;
  let visibility: DocumentVisibilityState = "visible";
  const docHandlers = new Set<() => void>();
  const winHandlers = new Set<() => void>();

  const doc: FocusDocument = {
    get visibilityState() {
      return visibility;
    },
    addEventListener: (_type, listener) => void docHandlers.add(listener),
    removeEventListener: (_type, listener) => void docHandlers.delete(listener),
  };
  const win: FocusWindow = {
    addEventListener: (_type, listener) => void winHandlers.add(listener),
    removeEventListener: (_type, listener) => void winHandlers.delete(listener),
  };

  let record: ActiveSession | null = null;
  const saves: ActiveSession[] = [];
  const store: ActiveSessionStore = {
    load: async () => (record ? { ...record } : null),
    save: async (session) => {
      record = { ...session };
      saves.push({ ...session });
    },
    clear: async () => {
      record = null;
    },
  };

  const invalidated: Array<{ session: ActiveSession; actualSec: number }> = [];
  const saveInvalidated = async (session: ActiveSession, actualSec: number) => {
    invalidated.push({ session, actualSec });
  };

  const make = () =>
    createFocusVisibilityService({ now: () => current, doc, win, store, saveInvalidated });

  return {
    service: make(),
    doc,
    win,
    /** Otro servicio sobre el mismo almacen: lo que pasa tras una recarga. */
    reload: make,
    store,
    saves,
    invalidated,
    get stored() {
      return record;
    },
    set stored(value: ActiveSession | null) {
      record = value;
    },
    listenerCount: () => docHandlers.size + winHandlers.size,
    now: () => current,
    set(ms: number) {
      current = ms;
    },
    advance(ms: number) {
      current += ms;
    },
    /** La pagina pasa a oculta (con su evento). */
    hide() {
      visibility = "hidden";
      docHandlers.forEach((fn) => fn());
    },
    /** La pagina vuelve a visible y se espera a que el servicio termine de decidir. */
    async show() {
      visibility = "visible";
      docHandlers.forEach((fn) => fn());
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
    /** Deja que terminen las escrituras pendientes al almacen. */
    async settle() {
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
    pagehide() {
      winHandlers.forEach((fn) => fn());
    },
  };
}

export type FocusEnv = ReturnType<typeof createFocusEnv>;
