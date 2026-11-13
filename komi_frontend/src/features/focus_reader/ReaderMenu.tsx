// Menu flotante del lector EPUB (SRS 10.8, mockup 04). Cinco acciones, en este orden: Hablar con
// Komi, Terminar sesion, Tamano de letra, Modo noche (o Modo dia) y Mostrar interfaz. Va sobre una
// veladura que tapa el texto: tocar la veladura, Escape o la X lo cierra. Cada accion cierra el
// menu antes de ejecutarse (lo hace quien lo usa).

import { Check, Eye, MessageCircle, Moon, Sun, Type, type LucideIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import type { ThemeId } from "../../core/theme/colorTokens";
import { ICON_STROKE_WIDTH } from "../../core/theme/geometryTokens";
import "./ReaderMenu.css";

export interface ReaderMenuProps {
  theme: ThemeId;
  onTalk: () => void;
  onFinish: () => void;
  onFontSize: () => void;
  onToggleTheme: () => void;
  onShowInterface: () => void;
  onClose: () => void;
}

const ICON_SIZE = 20;

interface Entry {
  key: string;
  label: string;
  Icon: LucideIcon;
  onSelect: () => void;
  /** Solo "Hablar con Komi": su icono lleva el fondo de acento. */
  accent?: boolean;
}

export function ReaderMenu({
  theme,
  onTalk,
  onFinish,
  onFontSize,
  onToggleTheme,
  onShowInterface,
  onClose,
}: ReaderMenuProps) {
  const first = useRef<HTMLButtonElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  // Foco al primer elemento al abrir y de vuelta a quien lo abrio al cerrar.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    first.current?.focus();
    return () => opener?.focus?.();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const entries: Entry[] = [
    { key: "talk", label: "Hablar con Komi", Icon: MessageCircle, onSelect: onTalk, accent: true },
    { key: "finish", label: "Terminar sesión", Icon: Check, onSelect: onFinish },
    { key: "font", label: "Tamaño de letra", Icon: Type, onSelect: onFontSize },
    {
      key: "theme",
      label: theme === "dark" ? "Modo día" : "Modo noche",
      Icon: theme === "dark" ? Sun : Moon,
      onSelect: onToggleTheme,
    },
    { key: "show", label: "Mostrar interfaz", Icon: Eye, onSelect: onShowInterface },
  ];

  return (
    <>
      <div className="reader-menu__veil" onClick={onClose} aria-hidden="true" />
      <div className="reader-menu" role="dialog" aria-label="Menú de lectura">
        <ul className="reader-menu__list">
          {entries.map(({ key, label, Icon, onSelect, accent }, index) => (
            <li key={key}>
              <button
                type="button"
                className="reader-menu__item"
                ref={index === 0 ? first : undefined}
                onClick={onSelect}
              >
                <span className={`reader-menu__icon${accent ? " reader-menu__icon--accent" : ""}`}>
                  <Icon size={ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" />
                </span>
                <span className="reader-menu__label">{label}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
