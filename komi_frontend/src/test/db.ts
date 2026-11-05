import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { KomiDatabase } from "../data/local_db/dexieDatabase";
import type { LocalClock } from "../data/local_db/localBookRepository";

let counter = 0;

/** Dependencias de IndexedDB falsas: una fabrica nueva por prueba, sin estado compartido. */
export function fakeIndexedDb() {
  return { indexedDB: new IDBFactory(), IDBKeyRange } as never;
}

export function createTestDb(name?: string): KomiDatabase {
  counter += 1;
  return new KomiDatabase(name ?? `komi-test-${counter}`, fakeIndexedDb());
}

/** UUID determinista para pruebas. */
export function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

export interface FakeClock extends LocalClock {
  advance(ms: number): void;
  set(iso: string): void;
}

/** Reloj controlable: `now` solo cambia cuando la prueba lo pide. */
export function fakeClock(startIso = "2026-11-05T10:00:00.000Z"): FakeClock {
  let time = Date.parse(startIso);
  let ids = 1000;
  return {
    now: () => new Date(time),
    newId: () => uuid((ids += 1)),
    advance: (ms) => {
      time += ms;
    },
    set: (iso) => {
      time = Date.parse(iso);
    },
  };
}
