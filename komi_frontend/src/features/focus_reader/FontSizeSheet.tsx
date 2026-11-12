// Selector del tamano de letra del lector (SRS 10.8): hoja inferior con las cuatro medidas, cada una
// con una muestra "Aa" a su tamano real. Elegir una la aplica al instante y deja la hoja abierta
// para probar; se cierra con la X, Escape o tocando el velo.

import { ZenSheet } from "../../core/components/ZenSheet";
import { FONT_SIZES, type ReaderFontSize } from "../../services/readerTheme";
import "./FontSizeSheet.css";

export interface FontSizeSheetProps {
  fontPx: ReaderFontSize;
  onFontPx: (size: ReaderFontSize) => void;
  onClose: () => void;
}

export function FontSizeSheet({ fontPx, onFontPx, onClose }: FontSizeSheetProps) {
  return (
    <ZenSheet title="Tamaño de letra" onClose={onClose}>
      <div className="font-size-sheet" role="radiogroup" aria-label="Tamaño de letra">
        {FONT_SIZES.map((size) => (
          <button
            key={size}
            type="button"
            role="radio"
            aria-checked={size === fontPx}
            aria-label={`${size} píxeles`}
            className={`font-size-sheet__option${size === fontPx ? " font-size-sheet__option--selected" : ""}`}
            onClick={() => onFontPx(size)}
          >
            <span className="font-size-sheet__sample" style={{ fontSize: `${size}px` }} aria-hidden="true">
              Aa
            </span>
            <span className="font-size-sheet__value tabular" aria-hidden="true">
              {size}
            </span>
          </button>
        ))}
      </div>
    </ZenSheet>
  );
}
