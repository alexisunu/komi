import { afterEach, describe, expect, it } from "vitest";
import { render } from "../../test/render";
import { ICON_STROKE_WIDTH } from "../theme/geometryTokens";
import { StreakBadge, streakLabel } from "./StreakBadge";
import css from "./StreakBadge.css?raw";

let mounted: ReturnType<typeof render> | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe("streakLabel", () => {
  it("usa el plural, el singular y el caso sin racha", () => {
    expect(streakLabel(5)).toBe("5 días seguidos");
    expect(streakLabel(2)).toBe("2 días seguidos");
    expect(streakLabel(1)).toBe("1 día seguido");
    expect(streakLabel(0)).toBe("Sin racha aún");
  });

  it("trata valores no validos como cero y trunca decimales", () => {
    expect(streakLabel(-3)).toBe("Sin racha aún");
    expect(streakLabel(Number.NaN)).toBe("Sin racha aún");
    expect(streakLabel(Number.POSITIVE_INFINITY)).toBe("Sin racha aún");
    expect(streakLabel(3.9)).toBe("3 días seguidos");
  });
});

describe("StreakBadge", () => {
  it("muestra el texto de la racha y su icono es decorativo", () => {
    mounted = render(<StreakBadge days={12} />);
    expect(mounted.container.textContent).toBe("12 días seguidos");
    const svg = mounted.container.querySelector("svg");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(svg?.getAttribute("stroke-width")).toBe(String(ICON_STROKE_WIDTH));
  });

  it("no es interactivo", () => {
    mounted = render(<StreakBadge days={3} />);
    expect(mounted.container.querySelector("button, a, [tabindex]")).toBeNull();
  });

  it("se actualiza cuando cambia la racha", () => {
    mounted = render(<StreakBadge days={1} />);
    mounted.rerender(<StreakBadge days={2} />);
    expect(mounted.container.textContent).toBe("2 días seguidos");
  });

  it("contrato visual: pildora con padding 6px 12px sobre Piedra Suave y numeros tabulares", () => {
    expect(css).toContain("padding: 6px 12px");
    expect(css).toContain("border-radius: var(--radius-pill)");
    expect(css).toContain("background: var(--color-bg-surface)");
    expect(css).toContain("font-variant-numeric: tabular-nums");
    expect(css).toMatch(/\.streak-badge__icon \{[^}]*color: var\(--color-accent-primary\)/);
  });
});
