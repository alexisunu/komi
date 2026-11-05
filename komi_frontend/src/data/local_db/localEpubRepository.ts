// Archivos .epub en el dispositivo (CLAUDE.md 6: el servidor nunca los recibe). Tabla aparte de
// `books` para no cargar megabytes al listar la biblioteca.

import { getDatabase, type KomiDatabase } from "./dexieDatabase";
import { InvalidBookError } from "./errors";
import { createLocalBookRepository, systemClock, type CreateBookInput, type LocalClock } from "./localBookRepository";
import { guardStorage } from "./storageGuard";
import type { LocalBook, LocalEpubFile } from "./types";

export interface PlantedEpub {
  book: LocalBook;
  /** Falso si el libro ya existia (mismo id): no se escribio nada. */
  created: boolean;
}

export function createLocalEpubRepository(
  db: KomiDatabase = getDatabase(),
  clock: LocalClock = systemClock,
) {
  const books = createLocalBookRepository(db, clock);

  function assertBytes(data: ArrayBuffer): void {
    if (!data || typeof data.byteLength !== "number" || data.byteLength === 0) {
      throw new InvalidBookError("file", "El archivo .epub esta vacio.");
    }
  }

  return {
    /**
     * Planta un libro EPUB: crea el libro y guarda su archivo en UNA transaccion. Si no cabe
     * (`StorageQuotaError`) o falla otra cosa, no queda ni el libro ni el archivo a medias.
     * Las `locations` (si ya estan listas) se guardan en la misma transaccion.
     * Idempotente por id: si el libro ya existe, no se toca su archivo.
     */
    async plantEpubBook(
      input: Omit<CreateBookInput, "format_type">,
      data: ArrayBuffer,
      locations: string | null = null,
    ): Promise<PlantedEpub> {
      assertBytes(data);
      return await guardStorage(() =>
        db.transaction("rw", db.books, db.epub_files, async () => {
          const id = input.id ?? clock.newId();
          const existing = await db.books.get(id);
          if (existing) return { book: existing, created: false };
          const book = await books.createBook({ ...input, id, format_type: "EPUB" });
          await db.epub_files.add({
            book_id: book.id,
            data,
            size_bytes: data.byteLength,
            locations,
            created_at: clock.now().toISOString(),
          });
          return { book, created: true };
        }),
      );
    },

    /**
     * Guarda el archivo de un libro ya plantado (por ejemplo, al reimportarlo despues de que
     * Safari lo purgo). Reemplaza el anterior y borra sus `locations`, que dependen del contenido.
     */
    async saveFile(bookId: string, data: ArrayBuffer): Promise<void> {
      assertBytes(data);
      await guardStorage(() =>
        db.transaction("rw", db.epub_files, async () => {
          await db.epub_files.put({
            book_id: bookId,
            data,
            size_bytes: data.byteLength,
            locations: null,
            created_at: clock.now().toISOString(),
          });
        }),
      );
    },

    getFile(bookId: string): Promise<LocalEpubFile | undefined> {
      return guardStorage(() => db.epub_files.get(bookId));
    },

    /** Sin leer los bytes: sirve para avisar "Reimportar archivo .epub" en la tarjeta. */
    async hasFile(bookId: string): Promise<boolean> {
      return (await guardStorage(() => db.epub_files.where("book_id").equals(bookId).count())) > 0;
    },

    /** `locations` ya generadas (JSON de epubjs) o null si aun no estan listas. */
    async getLocations(bookId: string): Promise<string | null> {
      const row = await guardStorage(() => db.epub_files.get(bookId));
      return row?.locations ?? null;
    },

    /** Devuelve falso si el archivo ya no esta (no crea una fila sin bytes). */
    saveLocations(bookId: string, locations: string): Promise<boolean> {
      return guardStorage(() =>
        db.transaction("rw", db.epub_files, async () => {
          const row = await db.epub_files.get(bookId);
          if (!row) return false;
          await db.epub_files.put({ ...row, locations });
          return true;
        }),
      );
    },
  };
}

export type LocalEpubRepository = ReturnType<typeof createLocalEpubRepository>;
