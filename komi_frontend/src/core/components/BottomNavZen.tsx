import { BookOpen, ChartColumn, Sprout, type LucideIcon } from "lucide-react";
import { ICON_STROKE_WIDTH } from "../theme/geometryTokens";
import "./BottomNavZen.css";

export type NavId = "lectura" | "jardin" | "estadisticas";

interface NavItem {
  id: NavId;
  label: string;
  Icon: LucideIcon;
}

/** Exactamente tres accesos, con tildes (CLAUDE.md 5, SRS 6 y 10.7). */
export const NAV_ITEMS: readonly NavItem[] = [
  { id: "lectura", label: "Lectura", Icon: BookOpen },
  { id: "jardin", label: "Mi Jardín", Icon: Sprout },
  { id: "estadisticas", label: "Estadísticas", Icon: ChartColumn },
];

export type NavSurface = "fixed" | "scroll";

interface BottomNavZenProps {
  active: NavId;
  onSelect: (id: NavId) => void;
  /** `fixed` = fondo Papel Arroz en vistas fijas; `scroll` = Lino Cálido sobre listas (SRS 10.7). */
  surface?: NavSurface;
}

const ICON_SIZE = 24;

export function BottomNavZen({ active, onSelect, surface = "fixed" }: BottomNavZenProps) {
  return (
    <nav className="bottom-nav" data-surface={surface} aria-label="Navegación principal">
      <ul className="bottom-nav__list">
        {NAV_ITEMS.map(({ id, label, Icon }) => {
          const isActive = id === active;
          return (
            <li key={id} className="bottom-nav__cell">
              <button
                type="button"
                className="bottom-nav__item"
                aria-current={isActive ? "page" : undefined}
                onClick={() => onSelect(id)}
              >
                <span className="bottom-nav__indicator" aria-hidden="true" />
                <Icon size={ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" />
                <span className="bottom-nav__label">{label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
