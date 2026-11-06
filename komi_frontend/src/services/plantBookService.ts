// Plantar un libro (CU-02): une la validacion del .epub, la preparacion de sus `locations` y el
// guardado local. Sin interfaz: el modal solo llama a estas funciones y muestra las fases.
//
// Orden del EPUB: leer y validar (inspect) -> "Preparando tu libro" (locations) -> guardar libro,
// archivo y locations en UNA transaccion. Si algo falla antes de guardar, no queda nada a medias.

import type { LocalBook } from "../data/local_db/types";
import type { LocalBookRepository } from "../data/local_db/localBookRepository";
import type { LocalEpubRepository } from "../data/local_db/localEpubRepository";
import { EpubImportError, type EpubMetadata, type EpubService } from "./epubService";
import { pickVariant as defaultPickVariant, type VariantPicker } from "./pickVariant";

export interface PlantBookDeps {
  epub: Pick<EpubService, "inspect" | "generateLocations">;
  epubFiles: Pick<LocalEpubRepository, "plantEpubBook" | "saveFile" | "saveLocations" | "getFile">;
  books: Pick<LocalBookRepository, "createBook">;
  pickVariant?: VariantPicker;
}

export interface PreparedEpub {
  data: ArrayBuffer;
  metadata: EpubMetadata;
}

export interface PlantPhysicalInput {
  title: string;
  author: string;
  total_pages: number;
}

/** Lo minimo de un `File` que se necesita (permite probar sin un File real). */
export interface FileLike {
  size: number;
  arrayBuffer?: () => Promise<ArrayBuffer>;
}

/** `Blob.arrayBuffer()` si existe; si no (WebKit antiguo, jsdom), `FileReader`. */
function readBytes(file: FileLike): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === "function") return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error("No se pudo leer el archivo."));
    reader.readAsArrayBuffer(file as Blob);
  });
}

export function createPlantBookService(deps: PlantBookDeps) {
  const pickVariant = deps.pickVariant ?? defaultPickVariant;

  /** Lee el archivo y lo valida. Lanza `EpubImportError` (not_epub, drm, unreadable, too_large). */
  async function prepareEpub(file: FileLike): Promise<PreparedEpub> {
    let data: ArrayBuffer;
    try {
      data = await readBytes(file);
    } catch (error) {
      throw new EpubImportError("unreadable", error);
    }
    return { data, metadata: await deps.epub.inspect(data) };
  }

  return {
    prepareEpub,

    /**
     * Planta el libro EPUB. `onPreparing` avisa a la interfaz cuando empieza el trabajo lento
     * (locations). Devuelve el libro guardado. Errores: `EpubImportError`, `StorageQuotaError`,
     * `InvalidBookError`.
     */
    async plantEpub(
      prepared: PreparedEpub,
      fields: { title: string; author: string },
      onPreparing?: () => void,
      onProgress?: (fraction: number) => void,
    ): Promise<LocalBook> {
      onPreparing?.();
      const locations = await deps.epub.generateLocations(prepared.data, onProgress);
      const { book } = await deps.epubFiles.plantEpubBook(
        { title: fields.title, author: fields.author, sunflower_variant: pickVariant() },
        prepared.data,
        locations,
      );
      return book;
    },

    /** Planta un libro fisico (FA-2.1). */
    async plantPhysical(input: PlantPhysicalInput): Promise<LocalBook> {
      return deps.books.createBook({
        title: input.title,
        author: input.author,
        format_type: "PHYSICAL",
        total_pages: input.total_pages,
        sunflower_variant: pickVariant(),
      });
    },

    /**
     * Deja listas las `locations` de un EPUB ya guardado antes de leerlo. Si ya estaban, no hace
     * nada. Si faltan (por ejemplo, no se alcanzaron a guardar), las genera con avance real y las
     * guarda. `onPreparing` solo se llama cuando hay trabajo lento. Devuelve falso si el archivo
     * ya no esta.
     */
    async ensureLocations(
      bookId: string,
      onPreparing?: () => void,
      onProgress?: (fraction: number) => void,
    ): Promise<boolean> {
      const file = await deps.epubFiles.getFile(bookId);
      if (!file) return false;
      if (file.locations) return true;
      onPreparing?.();
      const locations = await deps.epub.generateLocations(file.data, onProgress);
      await deps.epubFiles.saveLocations(bookId, locations);
      return true;
    },

    /**
     * Reimporta el archivo de un libro cuyo .epub ya no esta (Safari lo purgo). Conserva el
     * girasol y el progreso; vuelve a preparar las locations.
     */
    async reimportEpub(bookId: string, file: FileLike): Promise<void> {
      const prepared = await prepareEpub(file);
      const locations = await deps.epub.generateLocations(prepared.data);
      await deps.epubFiles.saveFile(bookId, prepared.data);
      await deps.epubFiles.saveLocations(bookId, locations);
    },
  };
}

export type PlantBookService = ReturnType<typeof createPlantBookService>;

/** Lo que usa Mi Jardin: plantar y reimportar. Preparar el libro para leerlo es cosa de la sesion. */
export type GardenPlantService = Pick<
  PlantBookService,
  "prepareEpub" | "plantEpub" | "plantPhysical" | "reimportEpub"
>;
