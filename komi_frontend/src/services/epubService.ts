// Motor epubjs (CU-02, SRS 10.8): valida el archivo, extrae titulo y autor y prepara las `locations`
// para calcular el porcentaje de lectura desde un CFI. `epubjs` se carga con `import()` dinamico:
// el Dashboard no paga su peso hasta que hace falta.
//
// El .epub se queda en el dispositivo (CLAUDE.md 6); nada de este modulo toca la red.

import type Book from "epubjs/types/book";
import { toPercentage } from "./readingTracker";

/** Tope de cordura para no agotar la memoria de un iPhone al leer el archivo completo. */
export const MAX_EPUB_BYTES = 100 * 1024 * 1024;
/**
 * epubjs 0.3.93 NO rechaza `book.opened` cuando el ZIP no tiene la estructura de un libro (por
 * ejemplo, sin `container.xml`): la promesa queda pendiente para siempre. Sin este tope, "Preparando
 * tu libro" no terminaria nunca. Un libro valido abre en milisegundos, incluso de 100 MB.
 */
export const OPEN_TIMEOUT_MS = 15_000;
/** Caracteres por "location" de epubjs: el valor habitual de la documentacion. */
export const LOCATION_CHARS = 1024;

export type EpubProblem =
  | "not_epub" // no es un .epub (ni un ZIP, o su `mimetype` es otro)
  | "too_large"
  | "drm" // protegido: no se puede leer (FA-2.2)
  | "unreadable"; // ZIP danado o estructura que epubjs no entiende

const MESSAGES: Record<EpubProblem, string> = {
  not_epub: "Este archivo no parece un libro .epub.",
  too_large: "Este archivo es demasiado grande para guardarlo en el dispositivo.",
  drm: "Este libro tiene protección (DRM) y Komi no puede abrirlo.",
  unreadable: "No pudimos leer este archivo .epub. Puede estar dañado.",
};

export class EpubImportError extends Error {
  readonly problem: EpubProblem;

  constructor(problem: EpubProblem, cause?: unknown) {
    super(MESSAGES[problem], cause === undefined ? undefined : { cause });
    this.name = "EpubImportError";
    this.problem = problem;
  }
}

export interface EpubMetadata {
  title: string;
  author: string;
}

type EpubFactory = (data: ArrayBuffer) => Book;

/** Carga epubjs bajo demanda. Se puede reemplazar en pruebas. */
async function defaultLoadEpubjs(): Promise<EpubFactory> {
  const module = await import("epubjs");
  return module.default as unknown as EpubFactory;
}

/** Los cuatro primeros bytes de un ZIP ("PK" 03 04). */
export function looksLikeZip(data: ArrayBuffer): boolean {
  if (data.byteLength < 4) return false;
  const head = new Uint8Array(data, 0, 4);
  return head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
}

/** Un ZIP completo termina con el registro "end of central directory" (PK 05 06). */
export function hasZipEnd(data: ArrayBuffer): boolean {
  const bytes = new Uint8Array(data);
  // El registro mide 22 bytes y puede ir seguido de un comentario de hasta 65535 bytes.
  const start = Math.max(0, bytes.length - 22 - 65_535);
  for (let i = bytes.length - 22; i >= start; i -= 1) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) return true;
  }
  return false;
}

// Algoritmos de OFUSCACION de fuentes que no son DRM: se admiten (SRS FA-2.2 habla de DRM incompatible).
const FONT_OBFUSCATION = new Set([
  "http://www.idpf.org/2008/embedding",
  "http://ns.adobe.com/pdf/enc#RC",
]);

/**
 * Un `.epub` con DRM trae `META-INF/rights.xml` (Adobe ADEPT y otros) o cifra contenido en
 * `META-INF/encryption.xml` con algo distinto de la ofuscacion de fuentes. Funcion pura.
 */
export function detectDrm(encryptionXml: string | null, rightsXml: string | null): boolean {
  if (rightsXml !== null && rightsXml.trim() !== "") return true;
  if (encryptionXml === null) return false;
  const algorithms = [...encryptionXml.matchAll(/Algorithm\s*=\s*["']([^"']+)["']/g)].map((m) => m[1] ?? "");
  return algorithms.some((algorithm) => !FONT_OBFUSCATION.has(algorithm));
}

async function readEntry(book: Book, path: string): Promise<string | null> {
  try {
    // epubjs devuelve `undefined` (no una promesa rechazada) si la entrada no existe.
    const text = await (book.archive.getText(path) as Promise<string> | undefined);
    return typeof text === "string" ? text : null;
  } catch {
    return null;
  }
}

/**
 * epubjs 0.3.93 no avisa del avance de `locations.generate`: procesa los capitulos (secciones
 * lineales del spine) uno a uno. Se envuelve `process`, que `generate` encola, para contar los
 * capitulos terminados. El avance es real: capitulos hechos / capitulos totales.
 */
function trackLocationProgress(book: Book, onProgress: (fraction: number) => void): void {
  let total = 0;
  book.spine.each((section: { linear?: boolean }) => {
    if (section.linear) total += 1;
  });
  if (total === 0) return;
  let done = 0;
  const locations = book.locations;
  const original = locations.process.bind(locations);
  locations.process = async (section) => {
    const result = await original(section);
    done += 1;
    onProgress(Math.min(done / total, 0.99));
    return result;
  };
}

export interface EpubServiceOptions {
  loadEpubjs?: () => Promise<EpubFactory>;
  openTimeoutMs?: number;
}

export function createEpubService(options: EpubServiceOptions = {}) {
  const loadEpubjs = options.loadEpubjs ?? defaultLoadEpubjs;
  const openTimeoutMs = options.openTimeoutMs ?? OPEN_TIMEOUT_MS;

  async function open(data: ArrayBuffer): Promise<Book> {
    if (data.byteLength > MAX_EPUB_BYTES) throw new EpubImportError("too_large");
    if (!looksLikeZip(data)) throw new EpubImportError("not_epub");
    if (!hasZipEnd(data)) throw new EpubImportError("unreadable"); // ZIP truncado
    let ePub: EpubFactory;
    try {
      ePub = await loadEpubjs();
    } catch (error) {
      throw new EpubImportError("unreadable", error);
    }
    const book = ePub(data);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        book.opened,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("epubjs no termino de abrir el libro")), openTimeoutMs);
        }),
      ]);
    } catch (error) {
      book.destroy();
      throw new EpubImportError("unreadable", error);
    } finally {
      clearTimeout(timer);
    }
    return book;
  }

  return {
    /**
     * Valida el archivo y extrae titulo y autor. Lanza `EpubImportError` con el motivo (FA-2.2).
     * Titulo o autor ausentes quedan vacios: la interfaz los pide al lector.
     */
    async inspect(data: ArrayBuffer): Promise<EpubMetadata> {
      const book = await open(data);
      try {
        const mimetype = await readEntry(book, "/mimetype");
        if (mimetype !== null && mimetype.trim() !== "application/epub+zip") {
          throw new EpubImportError("not_epub");
        }
        const [encryption, rights] = await Promise.all([
          readEntry(book, "/META-INF/encryption.xml"),
          readEntry(book, "/META-INF/rights.xml"),
        ]);
        if (detectDrm(encryption, rights)) throw new EpubImportError("drm");

        let metadata: { title?: string; creator?: string };
        try {
          metadata = await book.loaded.metadata;
        } catch (error) {
          throw new EpubImportError("unreadable", error);
        }
        return {
          title: (metadata.title ?? "").trim(),
          author: (metadata.creator ?? "").trim(),
        };
      } finally {
        book.destroy();
      }
    },

    /**
     * Abre el libro para leerlo (lector EPUB). Mismas validaciones y tope de tiempo que el resto;
     * quien lo pide debe llamar a `destroy()`.
     */
    async openBook(data: ArrayBuffer): Promise<Book> {
      const book = await open(data);
      try {
        await book.ready;
      } catch (error) {
        book.destroy();
        throw new EpubImportError("unreadable", error);
      }
      return book;
    },

    /**
     * Porcentaje EXACTO (0 a 100, truncado) de un CFI. Si ya hay `locations` las usa; si no, las
     * genera aqui (SRS 19, punto 7: nunca se guarda un porcentaje provisional). `null` si el CFI
     * no se puede ubicar.
     */
    async percentageAt(
      data: ArrayBuffer,
      cfi: string,
      locations: string | null,
      onProgress?: (fraction: number) => void,
    ): Promise<number | null> {
      const book = await open(data);
      try {
        await book.ready;
        if (locations) {
          book.locations.load(locations);
        } else {
          if (onProgress) trackLocationProgress(book, onProgress);
          await book.locations.generate(LOCATION_CHARS);
          onProgress?.(1);
        }
        return toPercentage(book.locations.percentageFromCfi(cfi));
      } catch (error) {
        throw error instanceof EpubImportError ? error : new EpubImportError("unreadable", error);
      } finally {
        book.destroy();
      }
    },

    /**
     * Genera las `locations` (JSON de epubjs) con las que se calcula el porcentaje desde un CFI.
     * Es lento en libros grandes; la interfaz muestra "Preparando tu libro" mientras tanto.
     */
    async generateLocations(data: ArrayBuffer, onProgress?: (fraction: number) => void): Promise<string> {
      const book = await open(data);
      try {
        await book.ready;
        if (onProgress) trackLocationProgress(book, onProgress);
        await book.locations.generate(LOCATION_CHARS);
        onProgress?.(1);
        return book.locations.save();
      } catch (error) {
        throw error instanceof EpubImportError ? error : new EpubImportError("unreadable", error);
      } finally {
        book.destroy();
      }
    },
  };
}

export type EpubService = ReturnType<typeof createEpubService>;
