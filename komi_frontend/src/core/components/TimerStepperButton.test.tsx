import { afterEach, describe, expect, it, vi } from "vitest";
import { click, render } from "../../test/render";
import { GEOMETRY, ICON_STROKE_WIDTH } from "../theme/geometryTokens";
import { TimerStepperButton } from "./TimerStepperButton";
import css from "./TimerStepperButton.css?raw";

let mounted: ReturnType<typeof render> | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

function mount(element: Parameters<typeof render>[0]) {
  mounted = render(element);
  return mounted.container.querySelector("button") as HTMLButtonElement;
}

describe("TimerStepperButton", () => {
  it("tiene el nombre accesible que se le da, y no depende del icono", () => {
    const button = mount(<TimerStepperButton direction="increment" aria-label="Aumentar tiempo" />);
    expect(button.getAttribute("aria-label")).toBe("Aumentar tiempo");
    expect(button.textContent).toBe("");
    expect(button.type).toBe("button");
  });

  it("el icono es decorativo y usa el grosor de trazo del sistema", () => {
    const button = mount(<TimerStepperButton direction="decrement" aria-label="Reducir tiempo" />);
    const svg = button.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(svg?.getAttribute("stroke-width")).toBe(String(ICON_STROKE_WIDTH));
    expect(ICON_STROKE_WIDTH).toBe(1.75);
  });

  it("decrement muestra [-] e increment muestra [+]", () => {
    const minus = mount(<TimerStepperButton direction="decrement" aria-label="Reducir" />);
    expect(minus.querySelector("svg")?.getAttribute("class")).toContain("lucide-minus");
    mounted?.unmount();
    const plus = mount(<TimerStepperButton direction="increment" aria-label="Aumentar" />);
    expect(plus.querySelector("svg")?.getAttribute("class")).toContain("lucide-plus");
  });

  it("dispara onClick y respeta disabled", () => {
    const onClick = vi.fn();
    const button = mount(
      <TimerStepperButton direction="increment" aria-label="Aumentar" onClick={onClick} />,
    );
    click(button);
    expect(onClick).toHaveBeenCalledTimes(1);

    mounted?.unmount();
    const blocked = vi.fn();
    const disabled = mount(
      <TimerStepperButton direction="increment" aria-label="Aumentar" disabled onClick={blocked} />,
    );
    click(disabled);
    expect(blocked).not.toHaveBeenCalled();
  });

  describe("contrato visual (SRS 10.1)", () => {
    it("mide 44x44 px, circular, sobre Piedra Suave", () => {
      expect(GEOMETRY["touch-target"]).toBe("44px");
      expect(css).toMatch(/\.timer-stepper \{[^}]*width: var\(--touch-target\)/);
      expect(css).toMatch(/\.timer-stepper \{[^}]*height: var\(--touch-target\)/);
      expect(css).toContain("border-radius: var(--radius-pill)");
      expect(css).toContain("background: var(--color-bg-surface)");
      expect(css).toContain("color: var(--color-text-primary)");
    });

    it("tiene foco visible y estado deshabilitado", () => {
      expect(css).toMatch(/\.timer-stepper:focus-visible[^{]*\{[^}]*outline: var\(--focus-ring-width\) solid var\(--color-text-primary\)/);
      expect(css).toMatch(/\.timer-stepper:disabled \{/);
    });
  });
});
