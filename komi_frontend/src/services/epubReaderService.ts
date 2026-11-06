// Lector EPUB sobre epubjs (CU-03, paso 4). Abre el libro, lo dibuja en un contenedor, aplica el
// tema, pasa de pagina con toques, deslizamientos y teclas, y avisa cada posicion (`relocated`).
// Todo lo que decide algo (porcentaje, extracto, frecuencia) vive en `readingTracker`; aqui solo
// se traduce epubjs a un contrato pequeno que la pantalla y las pruebas pueden sustituir.
//
// El contenido del libro se ejecuta con `allowScriptedContent: false`: el iframe va con `sandbox`
// sin `allow-scripts`, asi que ningun script del .epub corre (SRS 19.16).

import type Book from "epubjs/types/book";
import type { Location } from "epubjs/types/rendition";
import type Rendition from "epubjs/types/rendition";
import { keyAction, swipeAction, tapAction, toHostX, type TurnAction } from "./readerGestures";
import { buildReaderCss, type ReaderThemeInput } from "./readerTheme";
import { toPercentage } from "./readingTracker";
import type { EpubService } from "./epubService";

/** Posicion visible, ya traducida: `percentage` es `null` si el libro aun no tiene `locations`. */
export interface ReaderPosition {
  /** CFI del inicio de la pagina: donde se reabre el libro. */
  cfi: string;
  percentage: number | null;
  /** Texto de la pagina visible. */
  text: string;
}

export interface OpenReaderInput {
  data: ArrayBuffer;
  host: HTMLElement;
  /** JSON de `locations` ya generadas, o null. */
  locations: string | null;
  startCfi: string | null;
  theme: ReaderThemeInput;
  onPosition(position: ReaderPosition): void;
}

export interface ReaderHandle {
  next(): Promise<void>;
  prev(): Promise<void>;
  /** Reaplica colores y tamano (cambio de tema o de letra). */
  setTheme(theme: ReaderThemeInput): void;
  /** Vuelve a medir el contenedor (giro de pantalla, teclado). */
  resize(): void;
  destroy(): void;
}

export interface EpubReaderService {
  open(input: OpenReaderInput): Promise<ReaderHandle>;
}

/** Texto entre el inicio y el fin de la pagina. Vacio si epubjs no puede construir el rango. */
function visibleText(rendition: Rendition, location: Location): string {
  try {
    const start = rendition.getRange(location.start.cfi);
    const end = rendition.getRange(location.end.cfi);
    if (!start || !end) return "";
    start.setEnd(end.endContainer, end.endOffset);
    return start.toString();
  } catch {
    // Paginas que cruzan de un capitulo a otro: el rango no cabe en un solo documento.
    return "";
  }
}

export function createEpubReaderService(epub: Pick<EpubService, "openBook">): EpubReaderService {
  return {
    async open(input) {
      const book: Book = await epub.openBook(input.data);
      let hasLocations = false;
      if (input.locations) {
        try {
          book.locations.load(input.locations);
          hasLocations = book.locations.length() > 0;
        } catch {
          hasLocations = false; // locations danadas: se lee sin porcentaje, nunca con uno falso
        }
      }

      const rendition = book.renderTo(input.host, {
        width: Math.max(input.host.clientWidth, 1),
        height: Math.max(input.host.clientHeight, 1),
        flow: "paginated",
        spread: "none",
        allowScriptedContent: false,
      });

      const turn = (action: TurnAction) => {
        if (action === "next") void rendition.next();
        else if (action === "prev") void rendition.prev();
      };

      rendition.hooks.content.register((contents: { document: Document; window: Window }) => {
        const doc = contents.document;
        let touch: { x: number; y: number } | null = null;
        doc.addEventListener("touchstart", (event: TouchEvent) => {
          const point = event.changedTouches[0];
          touch = point ? { x: point.clientX, y: point.clientY } : null;
        });
        doc.addEventListener("touchend", (event: TouchEvent) => {
          const point = event.changedTouches[0];
          if (!touch || !point) return;
          const action = swipeAction(point.clientX - touch.x, point.clientY - touch.y);
          touch = null;
          if (action) {
            event.preventDefault(); // sin esto el deslizamiento tambien dispararia un toque
            turn(action);
          }
        });
        doc.addEventListener("click", (event: MouseEvent) => {
          const target = event.target as Element | null;
          if (target?.closest("a[href]")) return; // un enlace del libro manda
          // El iframe del capitulo mide varias paginas y se desplaza: el toque se mide contra el
          // contenedor visible, no contra el ancho del iframe.
          const frame = contents.window.frameElement?.getBoundingClientRect();
          const host = input.host.getBoundingClientRect();
          if (!frame) return;
          turn(tapAction(toHostX(event.clientX, frame.left, host.left), host.width));
        });
        doc.addEventListener("keydown", (event: KeyboardEvent) => turn(keyAction(event.key)));
      });

      rendition.on("relocated", (location: Location) => {
        const fraction = hasLocations ? book.locations.percentageFromCfi(location.end.cfi) : null;
        input.onPosition({
          cfi: location.start.cfi,
          percentage: toPercentage(fraction),
          text: visibleText(rendition, location),
        });
      });

      const applyTheme = (theme: ReaderThemeInput) => {
        rendition.themes.registerCss("komi", buildReaderCss(theme));
        rendition.themes.select("komi");
      };
      applyTheme(input.theme);

      try {
        await rendition.display(input.startCfi ?? undefined);
      } catch {
        // CFI viejo o de otra edicion del archivo: se abre desde el principio.
        await rendition.display();
      }

      return {
        next: () => rendition.next(),
        prev: () => rendition.prev(),
        setTheme: applyTheme,
        resize() {
          rendition.resize(Math.max(input.host.clientWidth, 1), Math.max(input.host.clientHeight, 1));
        },
        destroy() {
          try {
            rendition.destroy();
          } finally {
            book.destroy();
          }
        },
      };
    },
  };
}
