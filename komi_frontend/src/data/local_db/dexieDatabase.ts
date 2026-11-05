import Dexie, { type DexieOptions, type Table } from "dexie";
import { StorageUnavailableError } from "./errors";
import { translateStorageError } from "./storageGuard";
import type { LocalBook, LocalProfile, LocalSession, MetaEntry } from "./types";

export const DB_NAME = "komi";

/**
 * Version actual del esquema. Cada cambio de indices o de forma de los registros sube este numero
 * y agrega un bloque `this.version(n)` con su `upgrade`; las versiones anteriores se conservan
 * para que Dexie migre los datos existentes del lector.
 */
export const SCHEMA_VERSION = 1;

/**
 * Esquema v1. Solo se declaran las claves primarias y los indices que usan las consultas reales:
 *  - books.status: pestañas de Mi Jardin (activos, florecidos, en barbecho).
 *  - books.updated_at: orden de la lista y deteccion de cambios.
 *  - books.pending_sync, sessions.pending_sync: cola de sincronizacion (0 o 1).
 *  - sessions.book_id y [book_id+started_at_local]: sesiones de un libro en orden cronologico.
 *  - sessions.started_at_local: rachas y estadisticas semanales por fecha local.
 * Los .epub (Blob) se agregan en la Fase 4 en una tabla aparte, para no cargarlos al listar.
 */
export const STORES_V1 = {
  profile: "id",
  books: "id, status, updated_at, pending_sync",
  sessions: "id, book_id, started_at_local, pending_sync, [book_id+started_at_local]",
  meta: "key",
} as const;

export class KomiDatabase extends Dexie {
  // `declare` evita que los campos de clase pisen las tablas que Dexie define en el constructor.
  declare profile: Table<LocalProfile, string>;
  declare books: Table<LocalBook, string>;
  declare sessions: Table<LocalSession, string>;
  declare meta: Table<MetaEntry, string>;

  constructor(name: string = DB_NAME, options?: DexieOptions) {
    super(name, options);
    this.version(1).stores(STORES_V1);
  }
}

let shared: KomiDatabase | null = null;

/** Instancia compartida de la app. Se crea al primer uso, no al importar el modulo. */
export function getDatabase(): KomiDatabase {
  shared ??= new KomiDatabase();
  return shared;
}

export type StorageProbe = { ok: true } | { ok: false; error: Error };

/** Comprueba si IndexedDB se puede abrir, para avisar al lector antes de que falle una escritura. */
export async function probeStorage(db: KomiDatabase = getDatabase()): Promise<StorageProbe> {
  try {
    await db.open();
    return { ok: true };
  } catch (error) {
    const translated = translateStorageError(error);
    return { ok: false, error: translated instanceof Error ? translated : new StorageUnavailableError(error) };
  }
}
