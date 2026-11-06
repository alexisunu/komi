import { afterEach, describe, expect, it } from "vitest";
import { themeEntries, THEMES } from "../../core/theme/colorTokens";
import { GEOMETRY } from "../../core/theme/geometryTokens";
import { render } from "../../test/render";
import css from "./SunflowerStageWidget.css?raw";
import source from "./SunflowerStageWidget.tsx?raw";
import {
  isDormant,
  STAGE_NAMES,
  SunflowerStageWidget,
  sunflowerLabel,
} from "./SunflowerStageWidget";

let mounted: ReturnType<typeof render> | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

function unmount() {
  mounted?.unmount();
  mounted = null;
}

function mount(props: Parameters<typeof SunflowerStageWidget>[0]) {
  unmount();
  mounted = render(<SunflowerStageWidget {...props} />);
  return mounted.container.firstElementChild as HTMLElement;
}

describe("etapa segun el porcentaje (viene de botanicCalculator)", () => {
  it.each([
    [0, "1"],
    [12, "1"],
    [24, "1"],
    [24.99, "1"],
    [25, "2"],
    [59.99, "2"],
    [60, "3"],
    [99.99, "3"],
    [100, "4"],
  ])("%s por ciento es la etapa %s", (percentage, stage) => {
    expect(mount({ percentage }).dataset.stage).toBe(stage);
  });

  it("acota valores fuera de rango y no finitos", () => {
    expect(mount({ percentage: -5 }).dataset.stage).toBe("1");
    expect(mount({ percentage: 140 }).dataset.stage).toBe("4");
    expect(mount({ percentage: Number.NaN }).dataset.stage).toBe("1");
  });

  it("solo la etapa actual esta activa y las 4 estan dibujadas", () => {
    const root = mount({ percentage: 70 });
    const groups = [...root.querySelectorAll<SVGGElement>(".sunflower__stage")];
    expect(groups.map((g) => g.dataset["stageName"])).toEqual([
      "SEED_1",
      "STEM_2",
      "BUD_3",
      "BLOOM_4",
    ]);
    const active = groups.filter((g) => g.dataset["active"] === "true");
    expect(active.map((g) => g.dataset["stageName"])).toEqual(["BUD_3"]);
    for (const g of groups) expect(g.childElementCount).toBeGreaterThan(0);
  });

  it("cambia la etapa activa al actualizar el porcentaje", () => {
    mounted = render(<SunflowerStageWidget percentage={24.99} />);
    mounted.rerender(<SunflowerStageWidget percentage={25} />);
    const active = mounted.container.querySelector('[data-active="true"]');
    expect(active?.getAttribute("data-stage-name")).toBe("STEM_2");
  });
});

describe("etiqueta accesible", () => {
  it("texto exacto, con 'por ciento' en dos palabras", () => {
    expect(sunflowerLabel(33.33)).toBe("Girasol en etapa Tallo, 33 por ciento");
    expect(sunflowerLabel(33.33, { fallow: true })).toBe(
      "Girasol en barbecho, etapa Tallo, 33 por ciento",
    );
    expect(sunflowerLabel(0)).toBe("Girasol en etapa Semilla, 0 por ciento");
    expect(sunflowerLabel(80)).toBe("Girasol en etapa Capullo, 80 por ciento");
    expect(sunflowerLabel(100)).toBe("Girasol en etapa Flor, 100 por ciento");
  });

  it("el porcentaje se trunca: 99.99 dice 99 y 24.99 dice 24", () => {
    expect(sunflowerLabel(99.99)).toBe("Girasol en etapa Capullo, 99 por ciento");
    expect(sunflowerLabel(24.99)).toBe("Girasol en etapa Semilla, 24 por ciento");
    expect(sunflowerLabel(59.99)).toBe("Girasol en etapa Tallo, 59 por ciento");
  });

  it("el nombre de etapa coincide con la etapa dibujada en cada borde", () => {
    const expected: Array<[number, string]> = [
      [24.99, "Semilla"],
      [25, "Tallo"],
      [59.99, "Tallo"],
      [60, "Capullo"],
      [99.99, "Capullo"],
      [100, "Flor"],
    ];
    for (const [pct, name] of expected) {
      expect(sunflowerLabel(pct)).toContain(`etapa ${name},`);
    }
    expect(Object.values(STAGE_NAMES)).toEqual(["Semilla", "Tallo", "Capullo", "Flor"]);
  });

  it("el Bono de Vitalidad Solar se anuncia solo cuando esta activo", () => {
    expect(sunflowerLabel(12, { solarBonus: true })).toBe(
      "Girasol en etapa Semilla, 12 por ciento, con Bono de Vitalidad Solar",
    );
    expect(sunflowerLabel(12)).not.toContain("Bono");
  });

  it("el elemento tiene role=img con la etiqueta y el interior es decorativo", () => {
    const root = mount({ percentage: 33.33, fallow: true });
    expect(root.getAttribute("role")).toBe("img");
    expect(root.getAttribute("aria-label")).toBe("Girasol en barbecho, etapa Tallo, 33 por ciento");
    expect(root.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(root.querySelector(".sunflower__halo")?.getAttribute("aria-hidden")).toBe("true");
    expect(root.querySelector("button, a, input, [tabindex], title, desc, text")).toBeNull();
  });

  it("la etiqueta se actualiza con el porcentaje", () => {
    mounted = render(<SunflowerStageWidget percentage={59.99} />);
    mounted.rerender(<SunflowerStageWidget percentage={60} />);
    expect(mounted.container.firstElementChild?.getAttribute("aria-label")).toBe(
      "Girasol en etapa Capullo, 60 por ciento",
    );
  });
});

describe("barbecho", () => {
  it("aplica la clase y lo dice la etiqueta antes de la flor completa", () => {
    for (const percentage of [0, 24.99, 59.99, 99.99]) {
      const root = mount({ percentage, fallow: true });
      expect(root.classList.contains("sunflower--fallow")).toBe(true);
      expect(root.dataset["fallow"]).toBe("true");
      expect(root.getAttribute("aria-label")).toContain("en barbecho");
    }
  });

  it("sin la marca de barbecho no hay estado latente", () => {
    const root = mount({ percentage: 50 });
    expect(root.classList.contains("sunflower--fallow")).toBe(false);
    expect(root.dataset["fallow"]).toBe("false");
    expect(root.getAttribute("aria-label")).not.toContain("barbecho");
  });

  it("la flor completa ignora el barbecho", () => {
    const root = mount({ percentage: 100, fallow: true });
    expect(root.classList.contains("sunflower--fallow")).toBe(false);
    expect(root.dataset["fallow"]).toBe("false");
    expect(root.getAttribute("aria-label")).toBe("Girasol en etapa Flor, 100 por ciento");
    expect(isDormant(100, true)).toBe(false);
    expect(isDormant(99.99, true)).toBe(true);
    expect(isDormant(50, false)).toBe(false);
  });
});

describe("Bono de Vitalidad Solar, miniatura y tamano", () => {
  const aura = '[data-testid="solar-aura"]';
  const sparkles = '[data-testid="bloom-sparkles"]';

  it("el aura solo aparece con solarBonus", () => {
    expect(mount({ percentage: 10, solarBonus: true }).querySelector(aura)).not.toBeNull();
    expect(mount({ percentage: 10 }).querySelector(aura)).toBeNull();
  });

  it("los destellos son solo de la flor completa", () => {
    expect(mount({ percentage: 100 }).querySelector(sparkles)).not.toBeNull();
    expect(mount({ percentage: 99.99 }).querySelector(sparkles)).toBeNull();
  });

  it("la miniatura no lleva halo, aura ni destellos y mide 48 px", () => {
    const root = mount({ percentage: 100, solarBonus: true, mini: true });
    expect(root.querySelector(".sunflower__halo")).toBeNull();
    expect(root.querySelector(aura)).toBeNull();
    expect(root.querySelector(sparkles)).toBeNull();
    expect(root.style.width).toBe("48px");
    expect(root.style.height).toBe("48px");
  });

  it("mide 220 px por defecto (SRS 10.2) y respeta size", () => {
    expect(mount({ percentage: 5 }).style.width).toBe("220px");
    expect(mount({ percentage: 5, size: 96 }).style.height).toBe("96px");
  });
});

describe("solo tokens de color", () => {
  const COLOR_ATTRS = ["fill", "stroke", "stop-color", "color", "flood-color"];

  it("ningun atributo del SVG fija un color (solo none)", () => {
    const root = mount({ percentage: 100, solarBonus: true });
    const offenders: string[] = [];
    for (const el of root.querySelectorAll("*")) {
      for (const attr of COLOR_ATTRS) {
        const value = el.getAttribute(attr);
        if (value !== null && value !== "none") offenders.push(`${el.tagName}[${attr}=${value}]`);
      }
      if (el.getAttribute("style")) offenders.push(`${el.tagName} style`);
    }
    expect(offenders).toEqual([]);
    // El unico estilo en linea del contenedor es el tamano.
    expect(root.getAttribute("style")).toMatch(/^width: \d+px; height: \d+px;$/);
  });

  it("el CSS y el componente no contienen colores literales", () => {
    for (const [name, text] of [
      ["css", css],
      ["tsx", source],
    ] as const) {
      expect(text, name).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(text, name).not.toMatch(/\b(?:rgb|rgba|hsl|hsla|hwb|oklch|color-mix)\s*\(/i);
      expect(text, name).not.toMatch(/\b(?:white|black)\b/i);
    }
  });

  it("toda variable de color del CSS existe en los tokens del tema", () => {
    const defined = new Set(themeEntries(THEMES.light).map(([name]) => name));
    const used = [...css.matchAll(/var\((--color-[a-z-]+)\)/g)].map((m) => m[1] ?? "");
    expect(used.length).toBeGreaterThan(10);
    expect(used.filter((name) => !defined.has(name))).toEqual([]);
  });

  it("usa los tokens con el rol del Brand Sheet", () => {
    expect(css).toMatch(/\.sf-petal-outer \{[^}]*fill: var\(--color-accent-primary\)/);
    expect(css).toMatch(/\.sf-stem \{[^}]*stroke: var\(--color-accent-secondary\)/);
    expect(css).toMatch(/\.sf-leaf \{[^}]*fill: var\(--color-accent-secondary\)/);
    expect(css).toMatch(/\.sunflower--fallow \.sf-petal-outer \{[^}]*dormant-petal-outer/);
    expect(css).toMatch(/\.sunflower__halo \{[^}]*background: var\(--color-derived-bg-halo\)/);
  });
});

/** Declaraciones de todas las reglas cuya lista de selectores incluye `selector` exacto. */
function declarations(selector: string): string {
  const bodies: string[] = [];
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const match of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (match[1] ?? "").split(",").map((s) => s.trim());
    if (selectors.includes(selector)) bodies.push(match[2] ?? "");
  }
  return bodies.join("\n");
}

describe("contrato visual del CSS", () => {
  it("el selector de ayuda encuentra reglas agrupadas y simples", () => {
    expect(declarations(".sf-leaf")).toContain("stroke-width: 1.75");
    expect(declarations(".sf-leaf")).toContain("fill: var(--color-accent-secondary)");
    expect(declarations(".no-existe")).toBe("");
  });

  it("contornos de linea organica: text-primary de 1.75 en hojas, petalos, centro y tierra", () => {
    for (const selector of [".sf-leaf", ".sf-seed", ".sf-petal-outer", ".sf-petal-inner", ".sf-center", ".sf-soil"]) {
      const body = declarations(selector);
      expect(body, selector).toContain("stroke: var(--color-text-primary)");
      expect(body, selector).toContain("stroke-width: 1.75");
    }
    expect(declarations(".sf-soil-line")).toContain("stroke: var(--color-text-primary)");
  });

  it("rellenos de la flor y la semilla", () => {
    expect(declarations(".sf-center")).toContain("fill: var(--color-derived-text-on-accent)");
    expect(declarations(".sf-petal-inner")).toContain("fill: var(--color-derived-petal-inner)");
    expect(declarations(".sf-seed")).toContain("fill: var(--color-text-secondary)");
    expect(declarations(".sf-soil")).toContain("fill: var(--color-bg-surface)");
    expect(declarations(".sf-dot")).toContain("fill: var(--color-bg-surface)");
    const ring = declarations(".sf-ring");
    expect(ring).toContain("stroke: var(--color-text-secondary)");
    expect(ring).toContain("stroke-width: 1.25");
  });

  it("halo: bg-halo con borde sutil bg-surface (SRS 10.2)", () => {
    const halo = declarations(".sunflower__halo");
    expect(halo).toContain("background: var(--color-derived-bg-halo)");
    expect(halo).toContain("border: 1.5px solid var(--color-bg-surface)");
  });

  it("barbecho: tallo y hojas apagados, petalos latentes, halo punteado y opacidad 0.65", () => {
    expect(declarations(".sunflower--fallow .sf-stem")).toContain("stroke: var(--color-text-secondary)");
    expect(declarations(".sunflower--fallow .sf-leaf")).toContain("fill: var(--color-text-secondary)");
    expect(declarations(".sunflower--fallow .sf-petal-outer")).toContain(
      "fill: var(--color-derived-dormant-petal-outer)",
    );
    expect(declarations(".sunflower--fallow .sf-petal-inner")).toContain(
      "fill: var(--color-derived-dormant-petal-inner)",
    );
    expect(declarations(".sunflower--fallow .sunflower__halo")).toContain(
      "border: 1.5px dashed var(--color-border-subtle)",
    );
    expect(declarations(".sunflower--fallow .sunflower__svg")).toContain("opacity: 0.65");
  });

  it("aura solar: borde de 2px en accent-primary y elementos en accent-primary", () => {
    expect(declarations(".sunflower--bonus .sunflower__halo")).toContain(
      "border: 2px solid var(--color-accent-primary)",
    );
    expect(declarations(".sf-aura__glow")).toContain("fill: var(--color-accent-primary)");
    expect(declarations(".sf-aura__ring")).toContain("stroke: var(--color-accent-primary)");
    expect(declarations(".sf-aura__dot")).toContain("fill: var(--color-accent-primary)");
  });

  it("solo la etapa activa es visible", () => {
    expect(declarations(".sunflower__stage")).toContain("opacity: 0");
    expect(declarations('.sunflower__stage[data-active="true"]')).toContain("opacity: 1");
  });
});

describe("movimiento", () => {
  const outsideReducedMotion = css.replace(/@media[^{]*\{[\s\S]*$/, "");

  it("los tokens de transicion estan entre 300 y 400 ms con ease-out", () => {
    for (const value of [GEOMETRY["transition-theme"], GEOMETRY["transition-ui"]]) {
      const match = /^(\d+)ms ease-out$/.exec(value);
      expect(match, value).not.toBeNull();
      const ms = Number(match?.[1]);
      expect(ms).toBeGreaterThanOrEqual(300);
      expect(ms).toBeLessThanOrEqual(400);
    }
  });

  it("cada transicion del CSS usa esos tokens (o una duracion permitida con ease-out)", () => {
    const declarations = [...outsideReducedMotion.matchAll(/transition:([^;]+);/g)].map(
      (m) => m[1] ?? "",
    );
    expect(declarations.length).toBeGreaterThan(5);
    for (const decl of declarations) {
      for (const part of decl.split(",")) {
        const tokenUse = /var\(--transition-(?:theme|ui)\)/.test(part);
        const literal = /(\d+)ms\s+ease-out/.exec(part);
        const ok = tokenUse || (literal && Number(literal[1]) >= 300 && Number(literal[1]) <= 400);
        expect(ok, part).toBeTruthy();
      }
    }
  });

  it("el fundido entre etapas usa el token de 350 ms", () => {
    expect(css).toMatch(/\.sunflower__stage \{[^}]*transition: opacity var\(--transition-ui\)/);
  });

  it("fuera de reduced-motion, la unica animacion continua es la respiracion", () => {
    const users = [...outsideReducedMotion.matchAll(/([^{}]+)\{[^{}]*animation(?:-play-state)?\s*:/g)].map(
      (m) => (m[1] ?? "").replace(/\/\*[\s\S]*?\*\//g, "").trim(),
    );
    expect(users).toEqual([".sunflower--breathing .sunflower__svg", ".sunflower--breathing-paused .sunflower__svg"]);
  });

  it("los keyframes de la respiracion animan solo transform y opacity", () => {
    const start = css.indexOf("@keyframes sunflower-breathe");
    const end = css.indexOf(".sunflower--breathing .sunflower__svg");
    expect(start).toBeGreaterThanOrEqual(0);
    const properties = [...css.slice(start, end).matchAll(/^\s+([a-z-]+)\s*:/gm)].map((m) => m[1]);
    expect(new Set(properties)).toEqual(new Set(["transform", "opacity"]));
  });

  it("la respiracion se pausa en segundo plano con animation-play-state", () => {
    expect(css).toMatch(/\.sunflower--breathing-paused \.sunflower__svg \{[^}]*animation-play-state: paused/);
  });

  it("prefers-reduced-motion anula transiciones y animaciones del widget", () => {
    const block = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*)\}/.exec(css);
    expect(block).not.toBeNull();
    expect(block?.[1]).toMatch(/transition:\s*none\s*!important/);
    expect(block?.[1]).toMatch(/animation:\s*none\s*!important/);
    expect(block?.[1]).toContain(".sunflower *");
  });
});

describe("sin umbrales propios", () => {
  it("el widget toma la etapa de botanicCalculator", () => {
    expect(source).toMatch(/from "\.\.\/\.\.\/services\/botanicCalculator"/);
    expect(source).toContain("stageForProgress(percentage)");
    expect(source).not.toMatch(/percentage\s*[<>]=?\s*\d/);
  });
});

describe("prop breathing", () => {
  it("sin la prop no hay clases de respiracion", () => {
    mounted = render(<SunflowerStageWidget percentage={30} />);
    const root = mounted.container.querySelector(".sunflower");
    expect(root?.className).not.toContain("breathing");
  });

  it("breathing agrega la clase y breathingPaused la pausa", () => {
    mounted = render(<SunflowerStageWidget percentage={30} breathing />);
    const root = mounted.container.querySelector(".sunflower");
    expect(root?.className).toContain("sunflower--breathing");
    expect(root?.className).not.toContain("breathing-paused");
    mounted.rerender(<SunflowerStageWidget percentage={30} breathing breathingPaused />);
    expect(mounted.container.querySelector(".sunflower")?.className).toContain("sunflower--breathing-paused");
  });

  it("breathingPaused sin breathing no hace nada, y la miniatura no respira", () => {
    mounted = render(<SunflowerStageWidget percentage={30} breathingPaused />);
    expect(mounted.container.querySelector(".sunflower")?.className).not.toContain("breathing");
    mounted.rerender(<SunflowerStageWidget percentage={30} breathing mini />);
    expect(mounted.container.querySelector(".sunflower")?.className).not.toContain("breathing");
  });
});
