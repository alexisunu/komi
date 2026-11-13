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

/** Duracion del giro de pagina (mockup 06, SRS 10.8). */
export const PAGE_TURN_MS = 320;
/** Opacidad maxima del velo que atenua la pagina que sale (la pagina queda al 60 %). */
export const TURN_VEIL_OPACITY = 0.4;
/** Si el giro no se confirma en este plazo, se limpia igual: nunca queda una pagina retenida. */
export const TURN_COMMIT_TIMEOUT_MS = 1000;
/** Margen tras los 320 ms por si la pestana no avanza las animaciones (segundo plano). */
const TURN_SLACK_MS = 250;

/** Un giro animado en curso: `skip` lo completa ya (con el giro); `abort` lo descarta y limpia. */
interface RunningTurn {
  skip(): void;
  abort(): void;
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
  } catch {
    return false;
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

      // `gap: 0`: epubjs, por defecto, anade a cada lado y arriba/abajo la mitad de un hueco de
      // columnas (ancho/12, unos 14 px) DENTRO del iframe, que se sumaba a los 24 px de margen del
      // contenedor (medido: 38 px por lado, 9,7 %; el SRS 10.8 pide 24). Con un solo margen, el del
      // contenedor, el texto queda como en el mockup. Las columnas no necesitan hueco: la pagina
      // avanza por el ancho del contenedor.
      const rendition = book.renderTo(input.host, {
        width: Math.max(input.host.clientWidth, 1),
        height: Math.max(input.host.clientHeight, 1),
        flow: "paginated",
        spread: "none",
        gap: 0,
        allowScriptedContent: false,
      } as Parameters<Book["renderTo"]>[1] & { gap: number });

      // Punto de lectura que se conserva mientras se cambia el tamano de letra. Con otra letra la
      // paginacion cambia y `display(cfi)` cae en la pagina que CONTIENE ese punto, que empieza en
      // el o antes: si cada cambio partiera del inicio de la pagina vigente, la lectura iria
      // retrocediendo. Mientras `reflowActive`, los `relocated` (los de nuestros propios `display` y
      // los que dispara una fuente tardia) no mueven el ancla; solo la apaga una navegacion del
      // lector (pasar pagina, enlace del libro). No depende de ningun plazo.
      let anchorCfi: string | null = null;
      let reflowActive = false;
      // El libro ya se mostro (primer `display` hecho): antes no se anima ni se conserva el punto.
      let shown = false;
      const userNavigated = () => {
        reflowActive = false;
      };

      // Giro de pagina (mockup 06). epubjs no anima y `next()`/`prev()` pasan por una cola: el scroll
      // se aplica de 2 a 12 ms despues (medido en Edge), no en el mismo turno. Por eso se anima
      // PRIMERO (la pagina vecina ya esta en el mismo iframe: columnas CSS adyacentes), se mantiene el
      // estado final, se pide el giro y se limpia todo en el `requestAnimationFrame` que ve el
      // cambio de scroll, antes de pintar: sin fotograma intermedio. Los giros se encadenan, asi que
      // cada prediccion lee un `scrollLeft` ya aplicado. En el limite de capitulo, en la primera o
      // ultima pagina, con movimiento reducido o sin API de animaciones el cambio es instantaneo.
      // Solo se animan `transform` (de la vista) y `opacity` (de un velo del color de fondo).
      let turning: RunningTurn | null = null;
      let turnChain: Promise<void> = Promise.resolve();
      let pendingTurns = 0;

      const plainTurn = (action: TurnAction): Promise<void> =>
        Promise.resolve(action === "next" ? rendition.next() : rendition.prev()).then(
          () => {},
          () => {},
        );

      const animatedTurn = (action: TurnAction): Promise<void> | null => {
        const container = input.host.querySelector<HTMLElement>(".epub-container");
        const view = container?.querySelector<HTMLElement>(".epub-view") ?? null;
        if (!container || !view || typeof view.animate !== "function" || !shown || prefersReducedMotion()) {
          return null;
        }
        const width = container.offsetWidth;
        const left = container.scrollLeft;
        const total = container.scrollWidth;
        // Misma condicion que epubjs: si el giro cruzaria de capitulo (o no hay pagina), no se anima.
        const inside = action === "next" ? left + 2 * width <= total : left > 0.5;
        if (width <= 0 || !inside) return null;

        return new Promise<void>((resolve) => {
          const sign = action === "next" ? -1 : 1;
          const veil = document.createElement("div");
          veil.className = "epub-reader__turn-veil";
          input.host.appendChild(veil);
          const timing = { duration: PAGE_TURN_MS, easing: "ease-out", fill: "forwards" } as const;
          const shift = `translateX(${sign * width}px)`;
          const viewAnim = view.animate([{ transform: "translateX(0)" }, { transform: shift }], timing);
          const veilAnim = veil.animate(
            [
              { transform: "translateX(0)", opacity: 0 },
              { transform: shift, opacity: TURN_VEIL_OPACITY },
            ],
            timing,
          );

          let phase: "animating" | "committing" | "done" = "animating";
          let frame = 0;
          let commitTimer: ReturnType<typeof setTimeout> | undefined;

          // Quita animacion, velo y transform. Idempotente.
          const finish = () => {
            if (phase === "done") return;
            phase = "done";
            clearTimeout(animTimer);
            clearTimeout(commitTimer);
            if (frame) cancelAnimationFrame(frame);
            viewAnim.cancel();
            veilAnim.cancel();
            veil.remove();
            if (turning === running) turning = null;
            resolve();
          };

          const commit = () => {
            if (phase !== "animating") return;
            phase = "committing";
            clearTimeout(animTimer);
            let request: Promise<void>;
            try {
              request = Promise.resolve(action === "next" ? rendition.next() : rendition.prev());
            } catch {
              finish();
              return;
            }
            // El cambio de scroll (o de capitulo: otra vista u otro ancho) se ve en el rAF previo al
            // pintado: se limpia ahi mismo. Si la prediccion fallo y cruzo de capitulo, tambien.
            const watch = () => {
              if (phase !== "committing") return;
              const moved =
                container.scrollLeft !== left ||
                container.scrollWidth !== total ||
                container.querySelector(".epub-view") !== view;
              if (moved) finish();
              else frame = requestAnimationFrame(watch);
            };
            frame = requestAnimationFrame(watch);
            // Al resolverse la promesa el giro ya se aplico: lo que quede retenido sobra.
            void request.then(finish, finish);
            commitTimer = setTimeout(finish, TURN_COMMIT_TIMEOUT_MS);
          };

          const running: RunningTurn = {
            skip() {
              if (phase !== "animating") return;
              viewAnim.finish();
              commit();
            },
            abort: finish,
          };
          turning = running;
          viewAnim.finished.then(commit, () => {});
          const animTimer = setTimeout(commit, PAGE_TURN_MS + TURN_SLACK_MS);
        });
      };

      // Un toque durante el giro lo completa al instante y espera a que se aplique antes de
      // predecir el siguiente: no se saltan paginas ni se anima un limite de capitulo por error.
      const requestTurn = (action: TurnAction): Promise<void> => {
        userNavigated();
        turning?.skip();
        const run = () => animatedTurn(action) ?? plainTurn(action);
        // Sin giro pendiente arranca en el mismo turno; con uno pendiente, espera a que se aplique.
        const result = pendingTurns === 0 ? run() : turnChain.then(run, run);
        pendingTurns += 1;
        turnChain = result.then(() => {
          pendingTurns -= 1;
        });
        return turnChain;
      };

      const turn = (action: TurnAction) => {
        void requestTurn(action);
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
          if (target?.closest("a[href]")) {
            userNavigated();
            return; // un enlace del libro manda
          }
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
          cfi: reflowActive && anchorCfi ? anchorCfi : location.start.cfi,
          percentage: toPercentage(fraction),
          text: visibleText(rendition, location),
        });
      });

      // Anota el punto de lectura (o reutiliza el ancla vigente) antes de un reacomodo y lo
      // restaura despues: al instante y otra vez cuando el reflujo ya termino. Lo usan el cambio
      // de tamano de letra y el cambio de alto del contenedor (ocultar o mostrar la interfaz).
      const holdPoint = (): string | null => {
        const resumeAt = reflowActive && anchorCfi ? anchorCfi : currentStartCfi(rendition);
        if (resumeAt) {
          anchorCfi = resumeAt;
          reflowActive = true;
        }
        return resumeAt;
      };
      const restorePoint = (resumeAt: string | null) => {
        if (!resumeAt) return;
        // Un ajuste de posicion nunca debe romper la lectura.
        const back = () => Promise.resolve(rendition.display(resumeAt)).catch(() => {});
        void back();
        setTimeout(() => void back(), SETTLE_MS);
      };

      let currentFontPx = input.theme.fontPx;
      const applyTheme = (theme: ReaderThemeInput) => {
        // Con otro tamano de letra cambia la paginacion y la pagina vigente se desplaza: se anota
        // el CFI de inicio y se vuelve a el al reacomodar el texto (medido: sin esto, agrandar la
        // letra perdia la pagina). Cambiar solo el color no mueve nada.
        const fontChanged = theme.fontPx !== currentFontPx;
        if (fontChanged) turning?.abort(); // limpia el transform antes de anotar el punto
        const resumeAt = fontChanged ? holdPoint() : null;
        currentFontPx = theme.fontPx;
        themeCss = buildReaderCss(theme);
        rendition.themes.registerCss(THEME_KEY, themeCss);
        rendition.themes.select(THEME_KEY);
        restorePoint(resumeAt);
      };
      applyTheme(input.theme);

      // Tamano del contenedor y si el libro ya se mostro: solo un cambio real de tamano, ya con el
      // libro puesto, reacomoda el texto y pide conservar el punto (el aviso inicial del observador,
      // con el mismo tamano, no compite con la espera a las fuentes del reabrir).
      let lastWidth = Math.max(input.host.clientWidth, 1);
      let lastHeight = Math.max(input.host.clientHeight, 1);
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

      shown = true;

      return {
        next: () => requestTurn("next"),
        prev: () => requestTurn("prev"),
        setTheme: applyTheme,
        resize() {
          const width = Math.max(input.host.clientWidth, 1);
          const height = Math.max(input.host.clientHeight, 1);
          const changed = width !== lastWidth || height !== lastHeight;
          lastWidth = width;
          lastHeight = height;
          if (changed) turning?.abort(); // limpia el transform antes de anotar el punto
          const resumeAt = changed && shown ? holdPoint() : null;
          rendition.resize(width, height);
          restorePoint(resumeAt);
        },
        destroy() {
          turning?.abort();
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
