import { afterEach, describe, expect, it, vi } from "vitest";
import { click, render } from "../../test/render";
import { GEOMETRY } from "../theme/geometryTokens";
import { ZenPrimaryButton } from "./ZenPrimaryButton";
import css from "./ZenPrimaryButton.css?raw";

let mounted: ReturnType<typeof render> | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

function mount(element: Parameters<typeof render>[0]) {
  mounted = render(element);
  return mounted.container.querySelector("button") as HTMLButtonElement;
}

describe("ZenPrimaryButton", () => {
  it("es un boton con nombre accesible y type=button por defecto", () => {
    const button = mount(<ZenPrimaryButton>Comenzar Lectura</ZenPrimaryButton>);
    expect(button.tagName).toBe("BUTTON");
    expect(button.textContent).toBe("Comenzar Lectura");
    expect(button.type).toBe("button");
  });

  it("usa la variante primaria por defecto y admite la secundaria", () => {
    const primary = mount(<ZenPrimaryButton>Guardar</ZenPrimaryButton>);
    expect(primary.className).toContain("zen-btn--primary");
    mounted?.unmount();
    const secondary = mount(<ZenPrimaryButton variant="secondary">Cancelar</ZenPrimaryButton>);
    expect(secondary.className).toContain("zen-btn--secondary");
    expect(secondary.className).not.toContain("zen-btn--primary");
  });

  it("dispara onClick, pero no cuando esta deshabilitado", () => {
    const onClick = vi.fn();
    const button = mount(<ZenPrimaryButton onClick={onClick}>Guardar</ZenPrimaryButton>);
    click(button);
    expect(onClick).toHaveBeenCalledTimes(1);

    mounted?.unmount();
    const disabledClick = vi.fn();
    const disabled = mount(
      <ZenPrimaryButton disabled onClick={disabledClick}>
        Guardar
      </ZenPrimaryButton>,
    );
    click(disabled);
    expect(disabled.disabled).toBe(true);
    expect(disabledClick).not.toHaveBeenCalled();
  });

  it("conserva className adicional y atributos de accesibilidad", () => {
    const button = mount(
      <ZenPrimaryButton className="extra" aria-describedby="ayuda">
        Seguir
      </ZenPrimaryButton>,
    );
    expect(button.className).toContain("extra");
    expect(button.getAttribute("aria-describedby")).toBe("ayuda");
  });

  describe("contrato visual (SRS 10.1)", () => {
    it("el primario mide 56 px y al menos 220 px de ancho; el secundario 48 px", () => {
      expect(GEOMETRY["button-height"]).toBe("56px");
      expect(GEOMETRY["button-min-width"]).toBe("220px");
      expect(GEOMETRY["button-secondary-height"]).toBe("48px");
      expect(css).toMatch(/\.zen-btn--primary \{[^}]*min-height: var\(--button-height\)/);
      expect(css).toMatch(/\.zen-btn--primary \{[^}]*min-width: var\(--button-min-width\)/);
      expect(css).toMatch(/\.zen-btn--secondary \{[^}]*min-height: var\(--button-secondary-height\)/);
    });

    it("ambos superan los 44 px de area tactil", () => {
      expect(parseInt(GEOMETRY["button-secondary-height"])).toBeGreaterThanOrEqual(44);
    });

    it("es totalmente redondeado y usa tokens de color", () => {
      expect(css).toContain("border-radius: var(--radius-pill)");
      expect(css).toContain("background: var(--color-accent-primary)");
      expect(css).toMatch(/\.zen-btn--primary \{[^}]*color: var\(--color-derived-text-on-accent\)/);
      expect(css).toContain("var(--color-derived-accent-pressed)");
    });

    it("presionado escala 0.98 en ambas variantes", () => {
      for (const variant of ["primary", "secondary"]) {
        const rule = new RegExp(
          String.raw`\.zen-btn--${variant}:active,[^{]*\{[^}]*transform: scale\(0\.98\)`,
        );
        expect(css, variant).toMatch(rule);
      }
    });

    it("tiene foco visible", () => {
      expect(css).toMatch(/\.zen-btn:focus-visible[^{]*\{[^}]*outline: var\(--focus-ring-width\) solid var\(--color-text-primary\)/);
    });

    it("tiene estado deshabilitado", () => {
      expect(css).toMatch(/\.zen-btn:disabled \{/);
    });
  });
});
