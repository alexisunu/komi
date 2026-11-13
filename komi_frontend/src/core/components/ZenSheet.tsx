import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { ICON_STROKE_WIDTH } from "../theme/geometryTokens";
import "./ZenSheet.css";

interface ZenSheetProps {
  title: string;
  onClose: () => void;
  /** Falso mientras hay trabajo en curso: ni Escape, ni el velo, ni la X cierran la hoja. */
  dismissible?: boolean;
  /** `label`: titulo pequeno en sans y un asa arriba (hojas de resumen, como el fin de sesion). */
  titleVariant?: "heading" | "label";
  children: ReactNode;
}

const ICON_SIZE = 20;

/**
 * Hoja inferior modal (SRS 10.5): dialogo con velo, foco al titulo, Escape para cerrar y retorno
 * del foco al elemento que la abrio. El contenido y los botones los pone quien la usa.
 */
export function ZenSheet({ title, onClose, dismissible = true, titleVariant = "heading", children }: ZenSheetProps) {
  const titleId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    heading.current?.focus();
    return () => opener?.focus?.();
  }, []);

  useEffect(() => {
    if (!dismissible) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [dismissible]);

  return (
    <div className="zen-sheet-backdrop" onClick={dismissible ? onClose : undefined}>
      <section
        className={titleVariant === "label" ? "zen-sheet zen-sheet--label" : "zen-sheet"}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="zen-sheet__header">
          <h2 className="zen-sheet__title" id={titleId} ref={heading} tabIndex={-1}>
            {title}
          </h2>
          <button
            type="button"
            className="zen-sheet__close"
            aria-label="Cerrar"
            disabled={!dismissible}
            onClick={onClose}
          >
            <X size={ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
