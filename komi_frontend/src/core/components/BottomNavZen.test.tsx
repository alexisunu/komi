import { afterEach, describe, expect, it, vi } from "vitest";
import { click, render } from "../../test/render";
import { GEOMETRY, ICON_STROKE_WIDTH } from "../theme/geometryTokens";
import { BottomNavZen, NAV_ITEMS } from "./BottomNavZen";
import css from "./BottomNavZen.css?raw";

let mounted: ReturnType<typeof render> | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

function mount(element: Parameters<typeof render>[0]) {
  mounted = render(element);
  return mounted.container;
}

describe("BottomNavZen", () => {
  it("muestra exactamente las tres etiquetas, con tildes y en este orden", () => {
    const container = mount(<BottomNavZen active="lectura" onSelect={() => {}} />);
    const labels = Array.from(container.querySelectorAll("button")).map((b) => b.textContent);
    expect(labels).toEqual(["Lectura", "Mi Jardín", "Estadísticas"]);
  });

  it("las etiquetas estan en forma compuesta (NFC), no con acentos sueltos", () => {
    for (const { label } of NAV_ITEMS) {
      expect(label).toBe(label.normalize("NFC"));
    }
    expect(NAV_ITEMS.map((i) => i.label)).toEqual(["Lectura", "Mi Jardín", "Estadísticas"]);
    expect(NAV_ITEMS).toHaveLength(3);
  });

  it("es una region de navegacion con nombre accesible", () => {
    const container = mount(<BottomNavZen active="lectura" onSelect={() => {}} />);
    const nav = container.querySelector("nav");
    expect(nav).not.toBeNull();
    expect(nav?.getAttribute("aria-label")).toBe("Navegación principal");
    expect(container.querySelectorAll("li")).toHaveLength(3);
  });

  it("marca solo el acceso activo con aria-current=page", () => {
    const container = mount(<BottomNavZen active="jardin" onSelect={() => {}} />);
    const buttons = Array.from(container.querySelectorAll("button"));
    expect(buttons.map((b) => b.getAttribute("aria-current"))).toEqual([null, "page", null]);
  });

  it("avisa con el id del acceso pulsado", () => {
    const onSelect = vi.fn();
    const container = mount(<BottomNavZen active="lectura" onSelect={onSelect} />);
    const buttons = container.querySelectorAll("button");
    click(buttons[1]);
    click(buttons[2]);
    expect(onSelect.mock.calls).toEqual([["jardin"], ["estadisticas"]]);
  });

  it("los iconos son decorativos y usan el grosor de trazo del sistema", () => {
    const container = mount(<BottomNavZen active="lectura" onSelect={() => {}} />);
    const icons = container.querySelectorAll("button svg");
    expect(icons).toHaveLength(3);
    for (const icon of icons) {
      expect(icon.getAttribute("aria-hidden")).toBe("true");
      expect(icon.getAttribute("stroke-width")).toBe(String(ICON_STROKE_WIDTH));
    }
  });

  it("expone la superficie para el fondo fijo o de lista", () => {
    const fixed = mount(<BottomNavZen active="lectura" onSelect={() => {}} />);
    expect(fixed.querySelector("nav")?.getAttribute("data-surface")).toBe("fixed");
    mounted?.unmount();
    const scroll = mount(<BottomNavZen active="lectura" onSelect={() => {}} surface="scroll" />);
    expect(scroll.querySelector("nav")?.getAttribute("data-surface")).toBe("scroll");
  });

  describe("contrato visual (SRS 10.7)", () => {
    it("respeta el area segura inferior de iOS", () => {
      expect(css).toContain("env(safe-area-inset-bottom)");
      expect(css).toMatch(
        /\.bottom-nav \{[^}]*height: calc\(var\(--nav-height\) \+ env\(safe-area-inset-bottom\)\)/,
      );
      expect(css).toMatch(/\.bottom-nav \{[^}]*padding-bottom: env\(safe-area-inset-bottom\)/);
      expect(GEOMETRY["nav-height"]).toBe("64px");
    });

    it("cada acceso mide al menos 44 px de alto", () => {
      expect(css).toMatch(/\.bottom-nav__item \{[^}]*min-height: var\(--touch-target\)/);
      expect(css).toMatch(/\.bottom-nav__list \{[^}]*height: var\(--nav-height\)/);
      expect(parseInt(GEOMETRY["touch-target"])).toBeGreaterThanOrEqual(44);
    });

    it("usa Papel Arroz en vistas fijas y Lino Calido sobre listas", () => {
      expect(css).toMatch(/\.bottom-nav \{[^}]*background: var\(--color-bg-primary\)/);
      expect(css).toMatch(
        /\.bottom-nav\[data-surface="scroll"\] \{[^}]*background: var\(--color-bg-elevated\)/,
      );
    });

    it("tiene foco visible", () => {
      expect(css).toMatch(/\.bottom-nav__item:focus-visible \{[^}]*outline: var\(--focus-ring-width\) solid var\(--color-text-primary\)/);
    });
  });
});
