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
import { buildReaderCss, resolveReaderLanguage, type ReaderThemeInput } from "./readerTheme";
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
  /** Toque en el tercio central de la pantalla. Quien lo usa decide si abre algo. */
  onCenterTap?(): void;
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

/** CFI de inicio de la pagina visible, o `null` si epubjs aun no tiene posicion. */
function currentStartCfi(rendition: Rendition): string | null {
  try {
    const location = rendition.currentLocation() as unknown as { start?: { cfi?: string } } | undefined;
    return location?.start?.cfi ? location.start.cfi : null;
  } catch {
    return null;
  }
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

const THEME_KEY = "komi";

/** Espera a que termine el reflujo tras cambiar el tamano de letra antes de volver al CFI. */
export const SETTLE_MS = 250;

/** Tope de espera a las fuentes al reabrir: pasado el, se lee con lo que haya. */
export const FONT_WAIT_MS = 2_000;

/** Si alguna fuente del capitulo aun carga, espera (hasta `FONT_WAIT_MS`) y repite `display(cfi)`. */
async function redisplayAfterFonts(rendition: Rendition, cfi: string): Promise<void> {
  const contents = rendition.getContents() as unknown as Array<{ document?: Document }>;
  const loading = contents
    .map((content) => content.document?.fonts)
    .filter((fonts): fonts is FontFaceSet => fonts !== undefined && fonts.status !== "loaded");
  if (loading.length === 0) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.all(loading.map((fonts) => fonts.ready)),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, FONT_WAIT_MS);
      }),
    ]);
    await rendition.display(cfi);
  } catch {
    // La posicion ya estaba puesta: repetirla es solo un ajuste, nunca un motivo para fallar.
  } finally {
    clearTimeout(timer);
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

      // `dc:language` del libro; algunos EPUB mal formados no traen metadatos.
      const bookLanguage = (book as { packaging?: { metadata?: { language?: string } } }).packaging?.metadata
        ?.language;

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

      // CSS vigente del tema. epubjs NO inyecta en los capitulos nuevos los temas registrados con
      // `registerCss` (solo `rules` y `url`): sin esto cada capitulo nace con los estilos del libro
      // (fondo blanco, otra fuente) y recibe los de Komi despues, con un destello y un reflujo.
      let themeCss = buildReaderCss(input.theme);

      rendition.hooks.content.register(
        (contents: { document: Document; window: Window; addStylesheetCss(css: string, key: string): boolean }) => {
        contents.addStylesheetCss(themeCss, THEME_KEY);
        const doc = contents.document;
        // Sin `lang` el navegador no separa en silabas (`hyphens:auto`). Se respeta el del capitulo.
        const root = doc.documentElement;
        const language = resolveReaderLanguage(root.getAttribute("lang") ?? root.getAttribute("xml:lang"), bookLanguage);
        root.setAttribute("lang", language);
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
          const tap = tapAction(toHostX(event.clientX, frame.left, host.left), host.width);
          if (tap === "menu") input.onCenterTap?.();
          else turn(tap);
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

      let currentFontPx = input.theme.fontPx;
      const applyTheme = (theme: ReaderThemeInput) => {
        // Con otro tamano de letra cambia la paginacion y la pagina vigente se desplaza: se anota
        // el CFI de inicio y se vuelve a el al reacomodar el texto (medido: sin esto, agrandar la
        // letra perdia la pagina). Cambiar solo el color no mueve nada.
        const resumeAt = theme.fontPx !== currentFontPx ? currentStartCfi(rendition) : null;
        currentFontPx = theme.fontPx;
        themeCss = buildReaderCss(theme);
        rendition.themes.registerCss(THEME_KEY, themeCss);
        rendition.themes.select(THEME_KEY);
        if (resumeAt) {
          // Un ajuste de posicion nunca debe romper la lectura.
          // El texto se reacomoda despues de cambiar la hoja de estilos: se vuelve al CFI al
          // instante y otra vez cuando el reflujo ya termino.
          const back = () => Promise.resolve(rendition.display(resumeAt)).catch(() => {});
          void back();
          setTimeout(() => void back(), SETTLE_MS);
        }
      };
      applyTheme(input.theme);

      let reopened = false;
      try {
        await rendition.display(input.startCfi ?? undefined);
        reopened = input.startCfi !== null;
      } catch {
        // CFI viejo o de otra edicion del archivo: se abre desde el principio.
        await rendition.display();
      }
      // Lora se carga con `font-display: swap`: `display(cfi)` calcula la pagina con la fuente de
      // reserva y, al llegar Lora, el texto se reacomoda y la posicion queda una pagina antes. Solo
      // al reabrir (con CFI): se espera a las fuentes y se vuelve a ir al mismo CFI.
      if (reopened && input.startCfi) await redisplayAfterFonts(rendition, input.startCfi);

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
