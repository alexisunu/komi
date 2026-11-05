import { getDatabase, type KomiDatabase } from "./dexieDatabase";
import { BookNotFoundError, InvalidBookError } from "./errors";
import { isUuid } from "./sessionRules";
import { guardStorage } from "./storageGuard";
import type { BookStatus, FormatType, LocalBook, SunflowerVariant } from "./types";

export const MAX_TOTAL_PAGES = 100_000;
const MAX_TEXT_CHARS = 255;

export interface LocalClock {
  now: () => Date;
  newId: () => string;
}

export const systemClock: LocalClock = {
  now: () => new Date(),
  newId: () => crypto.randomUUID(),
};

export interface CreateBookInput {
  /** Opcional: si ya existe un libro con este id se devuelve tal cual (idempotente). */
  id?: string;
  title: string;
  author: string;
  format_type: FormatType;
  /** Obligatorio en libros fisicos (1 a 100000); se ignora en EPUB. */
  total_pages?: number | undefined;
  sunflower_variant?: SunflowerVariant | undefined;
}

export interface UpdateBookInput {
  title?: string;
  author?: string;
  sunflower_variant?: SunflowerVariant;
  /** Solo ACTIVE (devolver del barbecho) o FALLOW (archivar), como la sync (SRS 11.4). */
  status?: "ACTIVE" | "FALLOW";
}

/** ACTIVE devuelve el libro a su estado natural (espejo de garden/services.py). */
export function resolveStatus(book: LocalBook, requested: "ACTIVE" | "FALLOW"): BookStatus {
  if (requested !== "ACTIVE") return requested;
  if (book.progress_percentage >= 100) return "BLOOMED";
  if (book.status === "GROWING") return "GROWING";
  return "ACTIVE";
}

function cleanText(field: string, value: string): string {
  const text = value.trim();
  if (text.length === 0) throw new InvalidBookError(field, "No puede estar vacio.");
  if (text.length > MAX_TEXT_CHARS) {
    throw new InvalidBookError(field, `Admite hasta ${MAX_TEXT_CHARS} caracteres.`);
  }
  return text;
}

export function createLocalBookRepository(
  db: KomiDatabase = getDatabase(),
  clock: LocalClock = systemClock,
) {
  return {
    async createBook(input: CreateBookInput): Promise<LocalBook> {
      const title = cleanText("title", input.title);
      const author = cleanText("author", input.author);
      const physical = input.format_type === "PHYSICAL";
      if (input.format_type !== "PHYSICAL" && input.format_type !== "EPUB") {
        throw new InvalidBookError("format_type", "Formato desconocido.");
      }
      let totalPages: number | null = null;
      if (physical) {
        const pages = input.total_pages;
        if (pages === undefined) {
          throw new InvalidBookError("total_pages", "Es obligatorio para un libro fisico.");
        }
        if (!Number.isInteger(pages) || pages < 1 || pages > MAX_TOTAL_PAGES) {
          throw new InvalidBookError("total_pages", `Debe ser un entero de 1 a ${MAX_TOTAL_PAGES}.`);
        }
        totalPages = pages;
      }
      const id = input.id ?? clock.newId();
      if (!isUuid(id)) throw new InvalidBookError("id", "El id debe ser un UUID.");

      return guardStorage(() =>
        db.transaction("rw", db.books, async () => {
          const existing = await db.books.get(id);
          if (existing) return existing; // idempotente: nunca se sobrescribe
          const stamp = clock.now().toISOString();
          const book: LocalBook = {
            id,
            title,
            author,
            format_type: input.format_type,
            sunflower_variant: input.sunflower_variant ?? "CLASSIC",
            status: "ACTIVE",
            total_pages: totalPages,
            current_page: 0,
            progress_percentage: 0,
            last_epub_cfi: null,
            created_at: stamp,
            completed_at: null,
            updated_at: stamp,
            pending_sync: 1,
          };
          await db.books.add(book);
          return book;
        }),
      );
    },

    getBook(id: string): Promise<LocalBook | undefined> {
      return guardStorage(() => db.books.get(id));
    },

    /** Libros por estado (pestañas de Mi Jardin), el mas reciente primero. */
    listBooks(filter: { statuses?: readonly BookStatus[] } = {}): Promise<LocalBook[]> {
      return guardStorage(async () => {
        const books = filter.statuses
          ? await db.books.where("status").anyOf([...filter.statuses]).toArray()
          : await db.books.toArray();
        return books.sort((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0));
      });
    },

    /**
     * Cambia metadatos o estado. `updated_at` y la marca de pendiente solo cambian si algun valor
     * cambio de verdad: repetir la misma peticion no toca el libro (SRS 11.4).
     */
    updateBook(id: string, patch: UpdateBookInput): Promise<LocalBook> {
      return guardStorage(() =>
        db.transaction("rw", db.books, async () => {
          const book = await db.books.get(id);
          if (!book) throw new BookNotFoundError(id);

          const next: LocalBook = { ...book };
          if (patch.title !== undefined) next.title = cleanText("title", patch.title);
          if (patch.author !== undefined) next.author = cleanText("author", patch.author);
          if (patch.sunflower_variant !== undefined) next.sunflower_variant = patch.sunflower_variant;
          if (patch.status !== undefined) next.status = resolveStatus(book, patch.status);

          const changed =
            next.title !== book.title ||
            next.author !== book.author ||
            next.sunflower_variant !== book.sunflower_variant ||
            next.status !== book.status;
          if (!changed) return book;

          next.updated_at = clock.now().toISOString();
          next.pending_sync = 1;
          await db.books.put(next);
          return next;
        }),
      );
    },

    /** Libros con cambios sin enviar, para armar el lote de /profile/sync/. */
    listPendingBooks(): Promise<LocalBook[]> {
      return guardStorage(() => db.books.where("pending_sync").equals(1).toArray());
    },

    /**
     * Tras un sync exitoso. Solo limpia la marca de los libros que NO cambiaron mientras se
     * enviaba el lote (mismo `updated_at`); si cambiaron, siguen pendientes. No toca `updated_at`.
     */
    markBooksSynced(sent: ReadonlyArray<{ id: string; updated_at: string }>): Promise<void> {
      return guardStorage(() =>
        db.transaction("rw", db.books, async () => {
          for (const { id, updated_at } of sent) {
            const book = await db.books.get(id);
            if (book && book.updated_at === updated_at && book.pending_sync === 1) {
              await db.books.put({ ...book, pending_sync: 0 });
            }
          }
        }),
      );
    },
  };
}

export type LocalBookRepository = ReturnType<typeof createLocalBookRepository>;
