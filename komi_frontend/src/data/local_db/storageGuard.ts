import { KomiLocalError, StorageQuotaError, StorageUnavailableError } from "./errors";

// Nombres de error que Dexie y los navegadores usan para "sin espacio" y "no disponible".
const QUOTA_NAMES = new Set(["QuotaExceededError"]);
const UNAVAILABLE_NAMES = new Set([
  "MissingAPIError", // Dexie: no existe indexedDB
  "OpenFailedError", // Dexie: la base no abrio
  "DatabaseClosedError",
  "SecurityError", // acceso bloqueado por politica o modo privado
  "InvalidStateError", // Firefox en modo privado
  "UnknownError", // base danada o disco con fallas
]);

function nameChain(error: unknown): string[] {
  const names: string[] = [];
  let current: unknown = error;
  // Dexie envuelve el error original en `inner`; el original puede ser la causa real.
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth += 1) {
    const { name, inner, cause } = current as { name?: unknown; inner?: unknown; cause?: unknown };
    if (typeof name === "string") names.push(name);
    current = inner ?? cause;
  }
  return names;
}

/** Convierte errores de IndexedDB en errores propios; deja pasar los demas sin tocar. */
export function translateStorageError(error: unknown): unknown {
  if (error instanceof KomiLocalError) return error;
  const names = nameChain(error);
  if (names.some((name) => QUOTA_NAMES.has(name))) return new StorageQuotaError(error);
  if (names.some((name) => UNAVAILABLE_NAMES.has(name))) return new StorageUnavailableError(error);
  return error;
}

/** Ejecuta una operacion de almacenamiento y traduce sus fallos. */
export async function guardStorage<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw translateStorageError(error);
  }
}
