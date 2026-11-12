// Une el lector EPUB (epubjs), el registro de lectura y su escritura limitada. Abre el libro del
// dispositivo, reanuda la posicion, y mientras dura la sesion guarda CFI, porcentaje y extracto en
// `active_session_progress` (la posicion en cada cambio de pagina; el extracto, cada ~10 s) y
// vacia lo pendiente en pagehide y al ocultar la pestana. Nunca guarda un porcentaje si el
// libro no tiene `locations`.

import { useEffect, useRef, useState, type RefObject } from "react";
import type { LocalEpubRepository } from "../../data/local_db/localEpubRepository";
import type { LocalBook } from "../../data/local_db/types";
import type { EpubReaderService, ReaderHandle } from "../../services/epubReaderService";
import type { ReaderThemeInput } from "../../services/readerTheme";
import {
  createProgressWriter,
  createReadingTracker,
  pickResumeCfi,
  type ReadingProgress,
} from "../../services/readingTracker";

/** Cada cuanto se revisa si toca escribir. No cuenta tiempo: pregunta la hora al reloj. */
export const WRITE_CHECK_MS = 2_000;

export interface ReaderProgressStore {
  load(): Promise<ReadingProgress | null>;
  save(progress: ReadingProgress): Promise<void>;
  /** Posicion de lectura del libro (aparte del avance validado). `null` si no hay. */
  loadPosition(bookId: string): Promise<string | null>;
  savePosition(bookId: string, cfi: string): Promise<void>;
}

export interface EpubReaderDeps {
  reader: EpubReaderService;
  files: Pick<LocalEpubRepository, "getFile">;
  progress: ReaderProgressStore;
  now: () => number;
}

export type ReaderStatus = "loading" | "ready" | "missing" | "error";

export interface UseEpubReader {
  status: ReaderStatus;
  /** 0 a 100 o null mientras no haya `locations`. */
  percentage: number | null;
  /** Porcentaje del momento, leido sin esperar a un repintado (para "Terminar sesión"). */
  currentPercentage(): number | null;
  next(): void;
  prev(): void;
}

/**
 * El componente que lo usa se monta con `key={sessionId}`: cada sesion arranca con el estado
 * inicial ("loading", sin porcentaje), por eso el efecto no lo reinicia.
 */
export function useEpubReader(args: {
  deps: EpubReaderDeps;
  book: LocalBook;
  sessionId: string;
  host: RefObject<HTMLDivElement | null>;
  theme: ReaderThemeInput;
  /** Toque en el tercio central de la pagina. Se lee siempre la version mas reciente. */
  onCenterTap?: () => void;
}): UseEpubReader {
  const { deps, book, sessionId, host, theme, onCenterTap } = args;
  const latestCenterTap = useRef(onCenterTap);
  useEffect(() => {
    latestCenterTap.current = onCenterTap;
  });
  const [status, setStatus] = useState<ReaderStatus>("loading");
  const [percentage, setPercentage] = useState<number | null>(null);
  const handle = useRef<ReaderHandle | null>(null);
  const latestTheme = useRef(theme);
  const latestPercentage = useRef<number | null>(null);

  // Cambio de tema o de tamano: se reaplica al iframe ya abierto. Se compara por valor: el
  // llamador arma un objeto nuevo en cada render y, por identidad, se reinyectaria el CSS en
  // cada cambio de pagina (reflujo).
  const { theme: themeId, fontPx, fontBaseUrl } = theme;
  useEffect(() => {
    const next = { theme: themeId, fontPx, fontBaseUrl };
    latestTheme.current = next;
    handle.current?.setTheme(next);
  }, [themeId, fontPx, fontBaseUrl]);

  useEffect(() => {
    const container = host.current;
    if (!container) return undefined;
    let alive = true;
    const tracker = createReadingTracker(sessionId, deps.now);
    const writer = createProgressWriter({ now: deps.now, save: deps.progress.save });
    let opened: ReaderHandle | null = null;
    latestPercentage.current = null;

    // La posicion se guarda en cada pagina, en orden y aparte del avance: asi un cierre brusco o
    // una sesion invalidada no devuelven al lector al ultimo avance validado.
    let positionQueue: Promise<void> = Promise.resolve();
    let savedCfi: string | null = null;
    const rememberPosition = (cfi: string) => {
      if (cfi === savedCfi) return;
      savedCfi = cfi;
      positionQueue = positionQueue.then(() => deps.progress.savePosition(book.id, cfi).catch(() => {}));
    };

    const flushNow = () => void writer.flush();
    // Android puede matar la app sin `pagehide`; al pasar a segundo plano siempre hay
    // `visibilitychange`.
    const flushIfHidden = () => {
      if (document.visibilityState === "hidden") flushNow();
    };
    window.addEventListener("pagehide", flushNow);
    document.addEventListener("visibilitychange", flushIfHidden);
    const check = window.setInterval(() => void writer.flushIfDue(), WRITE_CHECK_MS);

    void (async () => {
      try {
        const file = await deps.files.getFile(book.id);
        if (!alive) return;
        if (!file) {
          setStatus("missing");
          return;
        }
        const saved = await deps.progress.load().catch(() => null);
        if (saved?.sessionId === sessionId) tracker.restore(saved);
        const savedPosition = await deps.progress.loadPosition(book.id).catch(() => null);
        if (!alive) return;
        savedCfi = savedPosition;
        const resume = pickResumeCfi({
          session: tracker.snapshot().cfi,
          saved: savedPosition,
          book: book.last_epub_cfi,
        });
        const next = await deps.reader.open({
          data: file.data,
          host: container,
          locations: file.locations,
          startCfi: resume,
          theme: latestTheme.current,
          onCenterTap: () => latestCenterTap.current?.(),
          onPosition(position) {
            if (!alive) return;
            rememberPosition(position.cfi);
            if (tracker.record(position)) void writer.update(tracker.snapshot());
            const current = tracker.snapshot().percentage;
            latestPercentage.current = current;
            setPercentage(current);
          },
        });
        if (!alive) {
          next.destroy();
          return;
        }
        opened = next;
        handle.current = next;
        setStatus("ready");
      } catch {
        if (alive) setStatus("error");
      }
    })();

    return () => {
      alive = false;
      window.removeEventListener("pagehide", flushNow);
      document.removeEventListener("visibilitychange", flushIfHidden);
      window.clearInterval(check);
      opened?.destroy();
      handle.current = null;
      // Ultimo estado a disco: el bloque de cierre lo lee despues de que esta pantalla se va.
      void writer.flush();
    };
  }, [deps, book.id, book.last_epub_cfi, sessionId, host]);

  // Ajuste al tamano del contenedor (giro de pantalla, barra del navegador).
  useEffect(() => {
    const container = host.current;
    if (!container || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => handle.current?.resize());
    observer.observe(container);
    return () => observer.disconnect();
  }, [host]);

  return {
    status,
    percentage,
    currentPercentage: () => latestPercentage.current,
    next: () => void handle.current?.next(),
    prev: () => void handle.current?.prev(),
  };
}
