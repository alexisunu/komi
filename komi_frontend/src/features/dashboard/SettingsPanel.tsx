import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTheme } from "../../core/theme/ThemeContext";
import { ICON_STROKE_WIDTH } from "../../core/theme/geometryTokens";
import { ZenPrimaryButton } from "../../core/components/ZenPrimaryButton";
import type { RestoreOutcome } from "../../data/network/restoreService";
import { FAILED_MESSAGE, restoreFailureMessage, restoreSummary } from "../recovery/recoveryMessages";
import "./SettingsPanel.css";

/** Recuperacion de datos desde Ajustes (Fase 5.3): el codigo de este dispositivo y volver a traer lo que falte. */
export interface SettingsRecovery {
  /** El `profile_id` del dispositivo. */
  code: string;
  /** Pide el historial al servidor y lo mezcla sin pisar nada local. */
  onRestore: () => Promise<RestoreOutcome>;
}

interface SettingsPanelProps {
  onClose: () => void;
  recovery?: SettingsRecovery | undefined;
  /** Para pruebas: copia el texto al portapapeles. */
  copyText?: (text: string) => Promise<void>;
}

const ICON_SIZE = 20;
export const RECOVERY_WARNING = "Quien tenga este código puede ver tus lecturas y charlas. Guárdalo solo donde confíes.";
const COPIED = "Código copiado.";
const COPY_FAILED = "No pudimos copiarlo. Mantén pulsado el código para copiarlo.";

function defaultCopy(text: string): Promise<void> {
  if (!navigator.clipboard) return Promise.reject(new Error("sin portapapeles"));
  return navigator.clipboard.writeText(text);
}

/**
 * Ajustes minimos de v1.0: el interruptor Claro/Oscuro y el codigo de recuperacion. Editar la meta o
 * el estilo de reflexion (FA-1.2) espera a su endpoint. Es un dialogo modal: Escape lo cierra y el
 * foco entra al titulo.
 */
export function SettingsPanel({ onClose, recovery, copyText = defaultCopy }: SettingsPanelProps) {
  const { theme, setTheme } = useTheme();
  const title = useRef<HTMLHeadingElement>(null);
  const dark = theme === "dark";
  const [copyNote, setCopyNote] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreNote, setRestoreNote] = useState<{ text: string; failed: boolean } | null>(null);

  useEffect(() => {
    title.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function copy() {
    if (!recovery) return;
    try {
      await copyText(recovery.code);
      setCopyNote(COPIED);
    } catch {
      setCopyNote(COPY_FAILED);
    }
  }

  async function restore() {
    if (!recovery) return;
    setRestoring(true);
    setRestoreNote(null);
    try {
      const outcome = await recovery.onRestore();
      setRestoreNote(
        outcome.kind === "restored"
          ? { text: restoreSummary(outcome.report), failed: false }
          : { text: restoreFailureMessage(outcome), failed: true },
      );
    } catch {
      setRestoreNote({ text: FAILED_MESSAGE, failed: true });
    } finally {
      setRestoring(false);
    }
  }

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
        {recovery && (
          <section className="settings-panel__recovery" aria-labelledby="recovery-title">
            <p className="settings-panel__label" id="recovery-title">
              Código de recuperación
            </p>
            <p className="settings-panel__hint">{RECOVERY_WARNING}</p>
            <p className="settings-panel__code" data-testid="recovery-code">
              {recovery.code}
            </p>
            <div className="settings-panel__actions">
              <ZenPrimaryButton variant="secondary" onClick={() => void copy()}>
                Copiar código
              </ZenPrimaryButton>
              <ZenPrimaryButton variant="secondary" onClick={() => void restore()} disabled={restoring}>
                {restoring ? "Trayendo tus datos" : "Volver a traer mis datos"}
              </ZenPrimaryButton>
            </div>
            {copyNote && (
              <p className="settings-panel__hint" role="status">
                {copyNote}
              </p>
            )}
            {restoreNote && (
              <p className="settings-panel__hint" role={restoreNote.failed ? "alert" : "status"}>
                {restoreNote.text}
              </p>
            )}
          </section>
        )}
      </section>
    </div>
  );
}
