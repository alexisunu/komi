import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTheme } from "../../core/theme/ThemeContext";
import { ICON_STROKE_WIDTH } from "../../core/theme/geometryTokens";
import "./SettingsPanel.css";

interface SettingsPanelProps {
  onClose: () => void;
}

const ICON_SIZE = 20;

/**
 * Ajustes minimos de v1.0 (bloque 7): solo el interruptor Claro/Oscuro. Editar la meta o el
 * estilo de reflexion (FA-1.2) espera a su endpoint. Es un dialogo modal: Escape lo cierra y el
 * foco entra al titulo.
 */
export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const { theme, setTheme } = useTheme();
  const title = useRef<HTMLHeadingElement>(null);
  const dark = theme === "dark";

  useEffect(() => {
    title.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="settings-backdrop" onClick={onClose}>
      <section
        className="settings-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="settings-panel__header">
          <h2 className="settings-panel__title" id="settings-title" ref={title} tabIndex={-1}>
            Ajustes
          </h2>
          <button type="button" className="settings-panel__close" aria-label="Cerrar ajustes" onClick={onClose}>
            <X size={ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" />
          </button>
        </header>
        <div className="settings-panel__row">
          <div>
            <p className="settings-panel__label" id="theme-label">
              Modo oscuro
            </p>
            <p className="settings-panel__hint">Tsukimi, pensado para leer de noche.</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={dark}
            aria-labelledby="theme-label"
            className="settings-switch"
            data-on={dark ? "true" : "false"}
            onClick={() => setTheme(dark ? "light" : "dark")}
          >
            <span className="settings-switch__thumb" aria-hidden="true" />
          </button>
        </div>
      </section>
    </div>
  );
}
