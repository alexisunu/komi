// Lector ePub Zen (CU-03, paso 4). Tres bloques: encabezado (reloj sutil y tamano de letra), la
// pagina del libro y el pie (pagina anterior, "Terminé antes de tiempo", pagina siguiente). Sin
// navegacion inferior. El tiempo lo lleva la misma maquina que el libro fisico: el aviso de gracia
// aparece en el encabezado cuando la pagina esta en segundo plano.

import { AArrowDown, AArrowUp, ChevronLeft, ChevronRight } from "lucide-react";
import { useRef, useState } from "react";
import { ZenPrimaryButton } from "../../core/components/ZenPrimaryButton";
import { ZenSheet } from "../../core/components/ZenSheet";
import type { ThemeId } from "../../core/theme/colorTokens";
import { ICON_STROKE_WIDTH } from "../../core/theme/geometryTokens";
import type { LocalBook } from "../../data/local_db/types";
import type { FocusSnapshot, FocusVisibilityService } from "../../services/focusVisibilityService";
import {
  FONT_SIZES,
  stepFontSize,
  type ReaderFontSize,
} from "../../services/readerTheme";
import { earlyFinishAllowed } from "../../services/readingTracker";
import type { WakeLockService } from "../../services/wakeLockService";
import { formatClock } from "./clockFormat";
import "./EpubReaderScreen.css";
import { GracePeriodBanner } from "./GracePeriodBanner";
import { useEpubReader, type EpubReaderDeps } from "./useEpubReader";
import { useWakeLock } from "./useWakeLock";

export interface EpubReaderScreenProps {
  book: LocalBook;
  /** Solo se muestra en las fases `running` y `grace`. */
  snapshot: FocusSnapshot;
  reader: EpubReaderDeps;
  wakeLock: WakeLockService;
  theme: ThemeId;
  fontPx: ReaderFontSize;
  onFontPx: (size: ReaderFontSize) => void;
  peekEarlyFinish: FocusVisibilityService["peekEarlyFinish"];
  onAcceptEarly: () => void;
  onCancel: () => void | Promise<void>;
}

const ICON_SIZE = 22;

function fontBaseUrl(): string {
  return new URL(import.meta.env.BASE_URL, window.location.origin).href;
}

export function EpubReaderScreen({
  book,
  snapshot,
  reader,
  wakeLock,
  theme,
  fontPx,
  onFontPx,
  peekEarlyFinish,
  onAcceptEarly,
  onCancel,
}: EpubReaderScreenProps) {
  const host = useRef<HTMLDivElement>(null);
  const [confirming, setConfirming] = useState(false);
  const inGrace = snapshot.phase === "grace";

  useWakeLock(wakeLock, true);

  const view = useEpubReader({
    deps: reader,
    book,
    sessionId: snapshot.sessionId,
    host,
    theme: { theme, fontPx, fontBaseUrl: fontBaseUrl() },
  });

  const finishEarly = () => {
    if (earlyFinishAllowed(peekEarlyFinish(), view.currentPercentage())) onAcceptEarly();
    else setConfirming(true);
  };

  // El tiempo siguio corriendo con la hoja abierta: puede que ya se pase del 50 %.
  const confirmCancel = () => {
    setConfirming(false);
    if (earlyFinishAllowed(peekEarlyFinish(), view.currentPercentage())) onAcceptEarly();
    else void onCancel();
  };

  const unavailable = view.status === "missing" || view.status === "error";

  return (
    <div className="epub-reader">
      <header className="epub-reader__header" data-block="header">
        <div className="epub-reader__bar">
          <div className="epub-reader__time">
            <output className="epub-reader__clock tabular" role="timer" aria-label="Tiempo restante">
              {formatClock(snapshot.remainingMs)}
            </output>
            {view.percentage !== null && (
              <span className="epub-reader__percent tabular" aria-label="Avance del libro">
                {Math.floor(view.percentage)} %
              </span>
            )}
          </div>
          <div className="epub-reader__fonts" role="group" aria-label="Tamaño de letra">
            <button
              type="button"
              className="epub-reader__icon"
              aria-label="Letra más pequeña"
              disabled={fontPx === FONT_SIZES[0]}
              onClick={() => onFontPx(stepFontSize(fontPx, "smaller"))}
            >
              <AArrowDown size={ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="epub-reader__icon"
              aria-label="Letra más grande"
              disabled={fontPx === FONT_SIZES[FONT_SIZES.length - 1]}
              onClick={() => onFontPx(stepFontSize(fontPx, "larger"))}
            >
              <AArrowUp size={ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" />
            </button>
          </div>
        </div>
        {inGrace && <GracePeriodBanner variant="grace" graceRemainingMs={snapshot.graceRemainingMs} />}
      </header>

      <section className="epub-reader__page" data-block="page" aria-label={book.title}>
        {/* El contenedor siempre existe para que epubjs lo mida; el aviso lo tapa si falta el archivo. */}
        <div ref={host} className="epub-reader__host" hidden={unavailable} />
        {view.status === "loading" && (
          <p className="epub-reader__status" role="status">
            Abriendo tu libro
          </p>
        )}
        {unavailable && (
          <div className="epub-reader__notice" role="alert">
            <p>
              {view.status === "missing"
                ? "El archivo .epub de este libro ya no está en el dispositivo. Vuelve a importarlo desde Mi Jardín para seguir leyendo."
                : "No pudimos abrir este libro. Puede estar dañado."}
            </p>
            <ZenPrimaryButton variant="secondary" onClick={() => void onCancel()}>
              Salir sin guardar
            </ZenPrimaryButton>
          </div>
        )}
      </section>

      <footer className="epub-reader__footer" data-block="actions">
        <button
          type="button"
          className="epub-reader__icon"
          aria-label="Página anterior"
          disabled={view.status !== "ready"}
          onClick={view.prev}
        >
          <ChevronLeft size={ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" />
        </button>
        <ZenPrimaryButton variant="secondary" onClick={finishEarly}>
          Terminé antes de tiempo
        </ZenPrimaryButton>
        <button
          type="button"
          className="epub-reader__icon"
          aria-label="Página siguiente"
          disabled={view.status !== "ready"}
          onClick={view.next}
        >
          <ChevronRight size={ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" />
        </button>
      </footer>

      {confirming && (
        <ZenSheet title="¿Terminar sin guardar?" onClose={() => setConfirming(false)}>
          <p className="epub-reader__confirm-text">
            Llevas menos de la mitad del tiempo que programaste. Si terminas ahora, la sesión se
            cancela y no se guarda ningún avance.
          </p>
          <div className="epub-reader__confirm-actions">
            <ZenPrimaryButton onClick={() => setConfirming(false)}>Seguir leyendo</ZenPrimaryButton>
            <ZenPrimaryButton variant="secondary" onClick={confirmCancel}>
              Cancelar sesión
            </ZenPrimaryButton>
          </div>
        </ZenSheet>
      )}
    </div>
  );
}
