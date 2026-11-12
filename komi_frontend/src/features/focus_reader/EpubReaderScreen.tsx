// Lector ePub Zen (CU-03, paso 4). Tres bloques: encabezado (reloj, avance, boton de tamano de
// letra y de ocultar), la pagina del libro y el pie (pagina anterior, "Terminar sesion", pagina
// siguiente). Sin navegacion inferior. La interfaz se puede ocultar (SRS 10.8): queda el texto,
// una linea de progreso de 2 px y un boton flotante que abre el menu (tambien el tercio central);
// cada sesion empieza con la interfaz visible.
// El tiempo lo lleva la misma maquina que el libro fisico: el aviso de gracia es una
// superposicion flotante arriba, visible tambien con la interfaz oculta.

import { ChevronLeft, ChevronRight, Ellipsis, EyeOff, Type, X } from "lucide-react";
import { useRef, useState } from "react";
import { ZenPrimaryButton } from "../../core/components/ZenPrimaryButton";
import { ZenSheet } from "../../core/components/ZenSheet";
import type { ThemeId } from "../../core/theme/colorTokens";
import { ICON_STROKE_WIDTH } from "../../core/theme/geometryTokens";
import type { LocalBook } from "../../data/local_db/types";
import type { FocusSnapshot, FocusVisibilityService } from "../../services/focusVisibilityService";
import type { ReaderFontSize } from "../../services/readerTheme";
import { earlyFinishAllowed } from "../../services/readingTracker";
import type { WakeLockService } from "../../services/wakeLockService";
import { formatClock } from "./clockFormat";
import "./EpubReaderScreen.css";
import { FontSizeSheet } from "./FontSizeSheet";
import { GracePeriodBanner } from "./GracePeriodBanner";
import { ReaderMenu } from "./ReaderMenu";
import { useEpubReader, type EpubReaderDeps } from "./useEpubReader";
import { useWakeLock } from "./useWakeLock";

export interface EpubReaderScreenProps {
  book: LocalBook;
  /** Solo se muestra en las fases `running` y `grace`. */
  snapshot: FocusSnapshot;
  reader: EpubReaderDeps;
  wakeLock: WakeLockService;
  theme: ThemeId;
  /** Cambia el tema de toda la app (Modo noche / Modo dia del menu). */
  onToggleTheme: () => void;
  fontPx: ReaderFontSize;
  onFontPx: (size: ReaderFontSize) => void;
  peekEarlyFinish: FocusVisibilityService["peekEarlyFinish"];
  onAcceptEarly: () => void;
  /**
   * "Hablar con Komi": se avisa justo antes de aceptar el cierre para que, al guardarse la lectura,
   * la charla se abra sola. Con menos del 50 % no se llama: la sesion se cancela y no hay charla.
   */
  onTalkRequested?: () => void;
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
  onToggleTheme,
  fontPx,
  onFontPx,
  peekEarlyFinish,
  onAcceptEarly,
  onTalkRequested,
  onCancel,
}: EpubReaderScreenProps) {
  const host = useRef<HTMLDivElement>(null);
  const [confirming, setConfirming] = useState(false);
  // Interfaz oculta: no se recuerda entre sesiones (la pantalla se monta con `key={sessionId}`).
  const [immersive, setImmersive] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [fontSheet, setFontSheet] = useState(false);
  const inGrace = snapshot.phase === "grace";

  useWakeLock(wakeLock, true);

  const view = useEpubReader({
    deps: reader,
    book,
    sessionId: snapshot.sessionId,
    host,
    theme: { theme, fontPx, fontBaseUrl: fontBaseUrl() },
    // Con la interfaz visible el tercio central no hace nada; oculta, abre el menu.
    onCenterTap: () => {
      if (immersive) setMenuOpen(true);
    },
  });

  const finishEarly = () => {
    if (earlyFinishAllowed(peekEarlyFinish(), view.currentPercentage())) onAcceptEarly();
    else setConfirming(true);
  };

  // Misma regla del 50 % que Terminar sesion, sin confirmacion extra: con el tiempo cumplido guarda y
  // abre la charla; con menos, aparece la misma hoja de siempre (cancelar o seguir leyendo).
  const talkToKomi = () => {
    if (earlyFinishAllowed(peekEarlyFinish(), view.currentPercentage())) {
      onTalkRequested?.();
      onAcceptEarly();
    } else setConfirming(true);
  };

  // El tiempo siguio corriendo con la hoja abierta: puede que ya se pase del 50 %.
  const confirmCancel = () => {
    setConfirming(false);
    if (earlyFinishAllowed(peekEarlyFinish(), view.currentPercentage())) onAcceptEarly();
    else void onCancel();
  };

  // Cada accion del menu lo cierra antes de ejecutarse.
  const fromMenu = (action: () => void) => () => {
    setMenuOpen(false);
    action();
  };

  const unavailable = view.status === "missing" || view.status === "error";

  return (
    <div className={`epub-reader${immersive ? " epub-reader--immersive" : ""}`}>
      {inGrace && (
        <div className="epub-reader__grace">
          <GracePeriodBanner variant="grace" graceRemainingMs={snapshot.graceRemainingMs} />
        </div>
      )}
      {!immersive && (
        <header className="epub-reader__header" data-block="header">
          <div className="epub-reader__bar">
            <div className="epub-reader__time">
              <output className="epub-reader__clock tabular" role="timer" aria-label="Tiempo restante">
                {formatClock(snapshot.remainingMs)}
              </output>
              <span className="epub-reader__percent tabular" aria-label="Modo y avance del libro">
                Temporizador
                {view.percentage !== null && <> · {Math.floor(view.percentage)} %</>}
              </span>
            </div>
            <div className="epub-reader__actions">
              <button
                type="button"
                className="epub-reader__icon epub-reader__icon--filled"
                aria-label="Tamaño de letra"
                onClick={() => setFontSheet(true)}
              >
                <Type size={ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="epub-reader__icon epub-reader__icon--filled"
                aria-label="Ocultar interfaz"
                onClick={() => setImmersive(true)}
              >
                <EyeOff size={ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" />
              </button>
            </div>
          </div>
        </header>
      )}

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

      {!immersive && (
        <footer className="epub-reader__footer" data-block="actions">
          <button
            type="button"
            className="epub-reader__icon epub-reader__icon--outlined"
            aria-label="Página anterior"
            disabled={view.status !== "ready"}
            onClick={view.prev}
          >
            <ChevronLeft size={ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" />
          </button>
          <ZenPrimaryButton variant="secondary" className="epub-reader__finish" onClick={finishEarly}>
            Terminar sesión
          </ZenPrimaryButton>
          <button
            type="button"
            className="epub-reader__icon epub-reader__icon--outlined"
            aria-label="Página siguiente"
            disabled={view.status !== "ready"}
            onClick={view.next}
          >
            <ChevronRight size={ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" />
          </button>
        </footer>
      )}

      {immersive && (
        <>
          {view.percentage !== null && (
            <div
              className="epub-reader__progress"
              role="progressbar"
              aria-label="Avance del libro"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.floor(view.percentage)}
            >
              <div className="epub-reader__progress-fill" style={{ transform: `scaleX(${view.percentage / 100})` }} />
            </div>
          )}
          <button
            type="button"
            className="epub-reader__float"
            aria-label={menuOpen ? "Cerrar menú" : "Abrir menú"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? (
              <X size={ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" />
            ) : (
              <Ellipsis size={ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" />
            )}
          </button>
          {menuOpen && (
            <ReaderMenu
              theme={theme}
              onClose={() => setMenuOpen(false)}
              onTalk={fromMenu(talkToKomi)}
              onFinish={fromMenu(finishEarly)}
              onFontSize={fromMenu(() => setFontSheet(true))}
              onToggleTheme={fromMenu(onToggleTheme)}
              onShowInterface={fromMenu(() => setImmersive(false))}
            />
          )}
        </>
      )}

      {fontSheet && <FontSizeSheet fontPx={fontPx} onFontPx={onFontPx} onClose={() => setFontSheet(false)} />}

      {confirming && (
        <ZenSheet title="¿Terminar sin guardar?" onClose={() => setConfirming(false)}>
          <p className="epub-reader__confirm-text">
            Aún no llevas la mitad del tiempo que programaste. Si terminas ahora, la sesión se
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
