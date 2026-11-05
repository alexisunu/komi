// Almacenamiento persistente (SRS 17 y CLAUDE.md 6): pide al navegador que no borre IndexedDB
// por falta de espacio. Safari puede denegarlo; el resultado se registra en consola y en `meta`
// para poder revisarlo en un iPhone real (Fase 5). Nunca lanza.

import type { MetaEntry } from "../data/local_db/types";

export type PersistResult = "granted" | "denied" | "already" | "unsupported" | "error";

export const STORAGE_PERSIST_META_KEY = "storage_persist_result";

export interface PersistDeps {
  storage: (Pick<StorageManager, "persist"> & Partial<Pick<StorageManager, "persisted">>) | undefined;
  meta: { set: (key: string, value: MetaEntry["value"]) => Promise<void> };
  log?: (message: string) => void;
}

export async function requestPersistentStorage({
  storage,
  meta,
  log = (message) => console.info(message),
}: PersistDeps): Promise<PersistResult> {
  let result: PersistResult;
  try {
    if (typeof storage?.persist !== "function") {
      result = "unsupported";
    } else if (typeof storage.persisted === "function" && (await storage.persisted())) {
      result = "already";
    } else {
      result = (await storage.persist()) ? "granted" : "denied";
    }
  } catch {
    result = "error";
  }
  log(`[komi] navigator.storage.persist(): ${result}`);
  try {
    await meta.set(STORAGE_PERSIST_META_KEY, result);
  } catch {
    // Solo es un registro de diagnostico.
  }
  return result;
}
