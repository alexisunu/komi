import { BookOpen, ChartColumn, Sprout, type LucideIcon } from "lucide-react";
import { FEATURES } from "../featureFlags";
import { ICON_STROKE_WIDTH } from "../theme/geometryTokens";
import "./BottomNavZen.css";

export type NavId = "lectura" | "jardin" | "estadisticas";

interface NavItem {
  id: NavId;
  label: string;
  Icon: LucideIcon;
}

const ALL_NAV_ITEMS: readonly NavItem[] = [
  { id: "lectura", label: "Lectura", Icon: BookOpen },
  { id: "jardin", label: "Mi Jardín", Icon: Sprout },
  { id: "estadisticas", label: "Estadísticas", Icon: ChartColumn },
];

/**
 * Accesos visibles, con tildes (CLAUDE.md 5, SRS 10.7 y 20). "Estadisticas" solo existe con la bandera
 * `statsAndStreak` encendida; sin ella son exactamente "Lectura" y "Mi Jardin".
 */
export function navItems(statsEnabled: boolean): readonly NavItem[] {
  return statsEnabled ? ALL_NAV_ITEMS : ALL_NAV_ITEMS.filter((item) => item.id !== "estadisticas");
}

export const NAV_ITEMS: readonly NavItem[] = navItems(FEATURES.statsAndStreak);

export type NavSurface = "fixed" | "scroll";

interface BottomNavZenProps {
  active: NavId;
  onSelect: (id: NavId) => void;
  /** `fixed` = fondo Papel Arroz en vistas fijas; `scroll` = Lino Cálido sobre listas (SRS 10.7). */
  surface?: NavSurface;
  /** Muestra "Estadisticas". Por defecto, la bandera de la app; las pruebas y la galeria lo fuerzan. */
  showStats?: boolean;
}

const ICON_SIZE = 24;

export function BottomNavZen({
  active,
  onSelect,
  surface = "fixed",
  showStats = FEATURES.statsAndStreak,
}: BottomNavZenProps) {
  return (
    <nav className="bottom-nav" data-surface={surface} aria-label="Navegación principal">
      <ul className="bottom-nav__list">
        {navItems(showStats).map(({ id, label, Icon }) => {
          const isActive = id === active;
          return (
            <li key={id} className="bottom-nav__cell">
              <button
                type="button"
                className="bottom-nav__item"
                aria-current={isActive ? "page" : undefined}
                onClick={() => onSelect(id)}
              >
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
