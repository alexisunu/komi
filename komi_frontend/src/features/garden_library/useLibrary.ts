// Biblioteca viva: los libros de Dexie y cuales EPUB perdieron su archivo. La pantalla de Mi Jardin
// y el Dashboard leen de aqui para que plantar o archivar un libro se vea al instante.

import { useCallback, useEffect, useRef, useState } from "react";
import type { LocalEpubRepository } from "../../data/local_db/localEpubRepository";
import type { LocalBookRepository } from "../../data/local_db/localBookRepository";
import type { LocalBook } from "../../data/local_db/types";

export interface LibraryDeps {
  books: Pick<LocalBookRepository, "listBooks">;
  epubFiles: Pick<LocalEpubRepository, "hasFile">;
}

export interface Library {
  books: LocalBook[];
  /** Ids de libros EPUB cuyo archivo ya no esta en el dispositivo. */
  missingFiles: ReadonlySet<string>;
  reload: () => Promise<void>;
}

interface Snapshot {
  books: LocalBook[];
  missing: Set<string>;
}

async function readLibrary(deps: LibraryDeps): Promise<Snapshot> {
  const books = await deps.books.listBooks();
  const missing = new Set<string>();
  for (const book of books) {
    if (book.format_type === "EPUB" && !(await deps.epubFiles.hasFile(book.id))) missing.add(book.id);
  }
  return { books, missing };
}

export function useLibrary(deps: LibraryDeps, initialBooks: LocalBook[]): Library {
  const [books, setBooks] = useState<LocalBook[]>(initialBooks);
  const [missingFiles, setMissingFiles] = useState<ReadonlySet<string>>(new Set());
  const alive = useRef(true);
  const latest = useRef(0);

  // Solo cuenta la lectura mas reciente, y nunca despues de desmontar.
  const apply = useCallback((turn: number, snapshot: Snapshot) => {
    if (alive.current && turn === latest.current) {
      setBooks(snapshot.books);
      setMissingFiles(snapshot.missing);
    }
  }, []);

  const reload = useCallback(async () => {
    const turn = (latest.current += 1);
    try {
      apply(turn, await readLibrary(deps));
    } catch {
      // Se conserva la lista en pantalla; Dexie sigue siendo la fuente.
    }
  }, [deps, apply]);

  useEffect(() => {
    alive.current = true;
    const turn = (latest.current += 1);
    readLibrary(deps)
      .then((snapshot) => apply(turn, snapshot))
      .catch(() => {});
    return () => {
      alive.current = false;
    };
  }, [deps, apply]);

  return { books, missingFiles, reload };
}
