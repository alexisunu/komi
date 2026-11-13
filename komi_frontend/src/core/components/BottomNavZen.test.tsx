import { afterEach, describe, expect, it, vi } from "vitest";
import { click, render } from "../../test/render";
import { GEOMETRY, ICON_STROKE_WIDTH } from "../theme/geometryTokens";
import { BottomNavZen, NAV_ITEMS, navItems } from "./BottomNavZen";
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
  it("con la bandera apagada (la v2) muestra exactamente Lectura y Mi Jardin, con tildes y en ese orden", () => {
    const container = mount(<BottomNavZen active="lectura" onSelect={() => {}} />);
    const labels = Array.from(container.querySelectorAll("button")).map((b) => b.textContent);
    expect(labels).toEqual(["Lectura", "Mi Jardín"]);
    expect(container.textContent).not.toContain("Estadísticas");
  });

  it("con la bandera encendida vuelven los tres accesos, Estadisticas al final", () => {
    const container = mount(<BottomNavZen active="lectura" onSelect={() => {}} showStats />);
    const labels = Array.from(container.querySelectorAll("button")).map((b) => b.textContent);
    expect(labels).toEqual(["Lectura", "Mi Jardín", "Estadísticas"]);
    expect(navItems(true).map((i) => i.id)).toEqual(["lectura", "jardin", "estadisticas"]);
    expect(navItems(false).map((i) => i.id)).toEqual(["lectura", "jardin"]);
  });

  it("las etiquetas estan en forma compuesta (NFC), no con acentos sueltos", () => {
    for (const { label } of NAV_ITEMS) {
      expect(label).toBe(label.normalize("NFC"));
    }
    for (const { label } of navItems(true)) expect(label).toBe(label.normalize("NFC"));
    expect(NAV_ITEMS.map((i) => i.label)).toEqual(["Lectura", "Mi Jardín"]);
    expect(NAV_ITEMS).toHaveLength(2);
  });

  it("es una region de navegacion con nombre accesible", () => {
    const container = mount(<BottomNavZen active="lectura" onSelect={() => {}} />);
    const nav = container.querySelector("nav");
    expect(nav).not.toBeNull();
    expect(nav?.getAttribute("aria-label")).toBe("Navegación principal");
    expect(container.querySelectorAll("li")).toHaveLength(2);
  });

  it("marca solo el acceso activo con aria-current=page", () => {
    const container = mount(<BottomNavZen active="jardin" onSelect={() => {}} />);
    const buttons = Array.from(container.querySelectorAll("button"));
    expect(buttons.map((b) => b.getAttribute("aria-current"))).toEqual([null, "page"]);
  });

  it("avisa con el id del acceso pulsado", () => {
    const onSelect = vi.fn();
    const container = mount(<BottomNavZen active="lectura" onSelect={onSelect} showStats />);
    const buttons = container.querySelectorAll("button");
    click(buttons[1]);
    click(buttons[2]);
    expect(onSelect.mock.calls).toEqual([["jardin"], ["estadisticas"]]);
  });

  it("los iconos son decorativos y usan el grosor de trazo del sistema", () => {
    const container = mount(<BottomNavZen active="lectura" onSelect={() => {}} />);
    const icons = container.querySelectorAll("button svg");
    expect(icons).toHaveLength(2);
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
      expect(css).toMatch(/\.bottom-nav__list \{[^}]*height: calc\(var\(--nav-height\) - 1px\)/);
      expect(parseInt(GEOMETRY["touch-target"])).toBeGreaterThanOrEqual(44);
    });

    it("usa Papel Arroz en vistas fijas y Lino Calido sobre listas", () => {
      expect(css).toMatch(/\.bottom-nav \{[^}]*background: var\(--color-bg-primary\)/);
      expect(css).toMatch(
        /\.bottom-nav\[data-surface="scroll"\] \{[^}]*background: var\(--color-bg-elevated\)/,
      );
    });

    it("el acceso activo va en una pildora sobre bg-surface, con icono y etiqueta en fila (mockup 07)", () => {
      expect(css).toMatch(/\.bottom-nav__item \{[^}]*flex-direction: row/);
      expect(css).toMatch(
        /\.bottom-nav__item\[aria-current="page"\] \{[^}]*background: var\(--color-bg-surface\)/,
      );
      expect(css).toMatch(/\.bottom-nav__item \{[^}]*border-radius: var\(--radius-pill\)/);
    });

    it("se reparte entre los accesos que haya, sean dos o tres", () => {
      expect(css).toMatch(/\.bottom-nav__list \{[^}]*grid-auto-columns: 1fr/);
      expect(css).not.toContain("repeat(3");
    });

    it("tiene foco visible", () => {
      expect(css).toMatch(/\.bottom-nav__item:focus-visible \{[^}]*outline: var\(--focus-ring-width\) solid var\(--color-text-primary\)/);
    });
  });
});
