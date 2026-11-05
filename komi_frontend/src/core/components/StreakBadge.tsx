import { Sun } from "lucide-react";
import { ICON_STROKE_WIDTH } from "../theme/geometryTokens";
import "./StreakBadge.css";

/** Texto de la racha: "5 días seguidos" (SRS 6). Valores no validos se tratan como 0. */
export function streakLabel(days: number): string {
  const safe = Number.isFinite(days) ? Math.max(0, Math.floor(days)) : 0;
  if (safe === 0) return "Sin racha aún";
  if (safe === 1) return "1 día seguido";
  return `${safe} días seguidos`;
}

interface StreakBadgeProps {
  days: number;
}

const ICON_SIZE = 16;

/** Píldora informativa del header (SRS 10.7). No es interactiva, por eso no lleva area tactil. */
export function StreakBadge({ days }: StreakBadgeProps) {
  return (
    <span className="streak-badge">
      <Sun
        className="streak-badge__icon"
        size={ICON_SIZE}
        strokeWidth={ICON_STROKE_WIDTH}
        aria-hidden="true"
      />
      <span className="streak-badge__text">{streakLabel(days)}</span>
    </span>
  );
}
