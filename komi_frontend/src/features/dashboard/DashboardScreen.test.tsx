import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../../core/theme/ThemeContext";
import type { LocalBook } from "../../data/local_db/types";
import { render } from "../../test/render";
import { DashboardScreen } from "./DashboardScreen";

let mounted: ReturnType<typeof render> | null = null;

beforeEach(() => {
  document.documentElement.removeAttribute("data-theme");
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }) as never,
  );
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.unstubAllGlobals();
});

const BOOK: LocalBook = {
  id: "00000000-0000-4000-8000-000000000001",
  title: "El nombre del viento",
  author: "Patrick Rothfuss",
  format_type: "PHYSICAL",
  sunflower_variant: "CLASSIC",
  status: "ACTIVE",
  total_pages: 250,
  current_page: 84,
  progress_percentage: 33.6,
  last_epub_cfi: null,
  created_at: "2026-11-01T00:00:00.000Z",
  completed_at: null,
  updated_at: "2026-11-01T00:00:00.000Z",
  pending_sync: 0,
};

function mount(props: Partial<Parameters<typeof DashboardScreen>[0]> = {}) {
  mounted = render(
    <ThemeProvider>
      <DashboardScreen streakDays={5} book={BOOK} dailyGoalMinutes={15} {...props} />
    </ThemeProvider>,
  );
  return mounted.container;
}

async function tap(el: Element | null | undefined) {
  if (!el) throw new Error("Elemento no encontrado");
  await act(async () => (el as HTMLElement).click());
}

const byLabel = (root: HTMLElement, label: string) => root.querySelector(`[aria-label="${label}"]`);
const time = (root: HTMLElement) => root.querySelector("output")?.textContent;

describe("zonas", () => {
  it("tiene 3 bloques (la navegacion es la cuarta zona, del shell)", () => {
    const root = mount();
    expect([...root.querySelectorAll("[data-block]")].map((b) => b.getAttribute("data-block"))).toEqual([
      "header",
      "canvas",
      "controls",
    ]);
  });

  it("con la racha oculta (la v2) el header muestra la marca Komi y el boton de ajustes, sin racha", () => {
    const root = mount({ streakDays: 5 });
    expect(root.querySelector(".dashboard__brand")?.textContent).toBe("Komi");
    expect(root.textContent).not.toContain("días seguidos");
    expect(root.textContent).not.toContain("Sin racha");
    expect(byLabel(root, "Ajustes")).not.toBeNull();
  });

  it("con la bandera encendida el header vuelve a mostrar la racha en lugar de la marca", () => {
    const root = mount({ streakDays: 5, showStreak: true });
    expect(root.textContent).toContain("5 días seguidos");
    expect(root.querySelector(".dashboard__brand")).toBeNull();
    expect(byLabel(root, "Ajustes")).not.toBeNull();
  });

  it("racha 0 y 1 (con la bandera encendida)", () => {
    expect(mount({ streakDays: 0, showStreak: true }).textContent).toContain("Sin racha aún");
    mounted?.unmount();
    expect(mount({ streakDays: 1, showStreak: true }).textContent).toContain("1 día seguido");
  });
});

describe("lienzo", () => {
  it("con libro: titulo, autor, barra y texto de progreso", () => {
    const root = mount();
    expect(root.querySelector("h1")?.textContent).toBe("El nombre del viento");
    expect(root.textContent).toContain("Patrick Rothfuss");
    expect(root.textContent).toContain("Pág. 84 de 250 — 33%");
    const bar = root.querySelector('[role="progressbar"]');
    expect(bar?.getAttribute("aria-valuenow")).toBe("33");
    expect(bar?.firstElementChild?.getAttribute("style")).toContain("width: 33%");
    expect(root.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe("Girasol en etapa Tallo, 33 por ciento");
  });

  it("un barbecho se dibuja latente", () => {
    const root = mount({ book: { ...BOOK, status: "FALLOW" } });
    expect(root.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe(
      "Girasol en barbecho, etapa Tallo, 33 por ciento",
    );
  });

  it("sin libro: 'Tu primera semilla te espera' con la semilla en 0 y sin barra", () => {
    const root = mount({ book: null });
    expect(root.querySelector("h1")?.textContent).toBe("Tu primera semilla te espera");
    expect(root.querySelector('[role="progressbar"]')).toBeNull();
    expect(root.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe("Girasol en etapa Semilla, 0 por ciento");
  });
});

describe("selector de tiempo", () => {
  it("arranca en la meta diaria del plan", () => {
    expect(time(mount({ dailyGoalMinutes: 30 }))).toBe("30:00");
  });

  it("[+] y [-] mueven de 5 en 5", async () => {
    const root = mount();
    await tap(byLabel(root, "Sumar 5 minutos"));
    expect(time(root)).toBe("20:00");
    await tap(byLabel(root, "Restar 5 minutos"));
    await tap(byLabel(root, "Restar 5 minutos"));
    expect(time(root)).toBe("10:00");
  });

  it("se deshabilita en 05:00 y en 120:00", async () => {
    const low = mount({ dailyGoalMinutes: 10 });
    await tap(byLabel(low, "Restar 5 minutos"));
    expect(time(low)).toBe("05:00");
    expect((byLabel(low, "Restar 5 minutos") as HTMLButtonElement).disabled).toBe(true);
    expect((byLabel(low, "Sumar 5 minutos") as HTMLButtonElement).disabled).toBe(false);
    mounted?.unmount();
    const high = mount({ dailyGoalMinutes: 120 });
    expect(time(high)).toBe("120:00");
    expect((byLabel(high, "Sumar 5 minutos") as HTMLButtonElement).disabled).toBe(true);
    expect((byLabel(high, "Restar 5 minutos") as HTMLButtonElement).disabled).toBe(false);
  });

  it("Comenzar lectura esta deshabilitado con y sin libro", () => {
    for (const book of [BOOK, null]) {
      const root = mount({ book });
      const cta = [...root.querySelectorAll("button")].find((b) => b.textContent === "Comenzar lectura");
      expect(cta?.disabled).toBe(true);
      mounted?.unmount();
    }
  });
});

describe("ajustes", () => {
  it("abre un dialogo con solo el interruptor Claro/Oscuro y lo cierra con Cerrar y con Escape", async () => {
    const root = mount();
    expect(root.querySelector('[role="dialog"]')).toBeNull();
    await tap(byLabel(root, "Ajustes"));
    const dialog = root.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    expect(dialog?.querySelectorAll('[role="switch"]').length).toBe(1);
    expect(dialog?.querySelectorAll("button").length).toBe(2); // cerrar + interruptor
    expect(document.activeElement?.textContent).toBe("Ajustes");
    await tap(byLabel(root, "Cerrar ajustes"));
    expect(root.querySelector('[role="dialog"]')).toBeNull();
    await tap(byLabel(root, "Ajustes"));
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(root.querySelector('[role="dialog"]')).toBeNull();
  });

  it("el interruptor cambia el tema y refleja aria-checked", async () => {
    const root = mount();
    await tap(byLabel(root, "Ajustes"));
    const sw = () => root.querySelector('[role="switch"]') as HTMLElement;
    expect(sw().getAttribute("aria-checked")).toBe("false");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    await tap(sw());
    expect(sw().getAttribute("aria-checked")).toBe("true");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    await tap(sw());
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("tocar fuera del panel lo cierra, tocar dentro no", async () => {
    const root = mount();
    await tap(byLabel(root, "Ajustes"));
    await tap(root.querySelector(".settings-panel"));
    expect(root.querySelector('[role="dialog"]')).not.toBeNull();
    await tap(root.querySelector(".settings-backdrop"));
    expect(root.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe("selector Temporizador | Libre (mockup 07)", () => {
  const radios = (root: HTMLElement) => [...root.querySelectorAll('[role="radio"]')] as HTMLButtonElement[];
  const cta = (root: HTMLElement) =>
    [...root.querySelectorAll("button")].find((b) => b.textContent === "Comenzar lectura") as HTMLButtonElement;

  it("es un grupo de dos opciones y empieza en Temporizador", () => {
    const root = mount();
    expect(root.querySelector('[role="radiogroup"]')?.getAttribute("aria-label")).toBe("Modo de lectura");
    expect(radios(root).map((r) => r.textContent)).toEqual(["Temporizador", "Libre"]);
    expect(radios(root).map((r) => r.getAttribute("aria-checked"))).toEqual(["true", "false"]);
    expect(time(root)).toBe("15:00");
  });

  it("sigue siendo uno de los tres bloques del Dashboard: el selector va dentro de los controles", () => {
    const root = mount();
    expect(root.querySelectorAll("[data-block]")).toHaveLength(3);
    expect(root.querySelector('[data-block="controls"] [role="radiogroup"]')).not.toBeNull();
  });

  it("Libre reemplaza al selector de minutos por el texto con el icono de infinito", async () => {
    const root = mount();
    await tap(radios(root)[1]);
    expect(radios(root).map((r) => r.getAttribute("aria-checked"))).toEqual(["false", "true"]);
    expect(byLabel(root, "Restar 5 minutos")).toBeNull();
    expect(byLabel(root, "Sumar 5 minutos")).toBeNull();
    expect(root.querySelector("output")).toBeNull();
    const note = root.querySelector(".dashboard__free");
    expect(note?.textContent).toBe("Sin límite de tiempo. El cronómetro empieza al abrir el lector.");
    expect(note?.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("volver a Temporizador devuelve los minutos, con el valor que se habia elegido", async () => {
    const root = mount();
    await tap(byLabel(root, "Sumar 5 minutos"));
    expect(time(root)).toBe("20:00");
    await tap(radios(root)[1]);
    await tap(radios(root)[0]);
    expect(time(root)).toBe("20:00");
    expect(root.querySelector(".dashboard__free")).toBeNull();
  });

  it("onTimerTypeChange avisa de cada cambio para recordar la eleccion", async () => {
    const onTimerTypeChange = vi.fn();
    const root = mount({ onTimerTypeChange });
    await tap(radios(root)[1]);
    expect(onTimerTypeChange).toHaveBeenLastCalledWith("FREE");
    await tap(radios(root)[0]);
    expect(onTimerTypeChange).toHaveBeenLastCalledWith("TIMER");
  });

  it("con la prop timerType manda el modo que llega de fuera", () => {
    const root = mount({ timerType: "FREE" });
    expect(radios(root)[1]?.getAttribute("aria-checked")).toBe("true");
    expect(root.querySelector(".dashboard__free")).not.toBeNull();
  });

  it("onStart recibe el modo y los minutos: Temporizador con los minutos elegidos", async () => {
    const onStart = vi.fn();
    const root = mount({ canStart: true, onStart });
    await tap(byLabel(root, "Sumar 5 minutos"));
    await tap(cta(root));
    expect(onStart).toHaveBeenCalledWith({ timerType: "TIMER", minutes: 20 });
  });

  it("onStart en Libre envia timerType FREE", async () => {
    const onStart = vi.fn();
    const root = mount({ canStart: true, onStart });
    await tap(radios(root)[1]);
    await tap(cta(root));
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStart.mock.calls[0]?.[0]).toMatchObject({ timerType: "FREE" });
  });

  it("el boton dice Comenzar lectura con un libro fisico y con un EPUB, y nunca Abrir lector", () => {
    for (const book of [BOOK, { ...BOOK, format_type: "EPUB" as const, total_pages: null }]) {
      const root = mount({ book, canStart: true, onStart: () => {} });
      expect(cta(root).textContent).toBe("Comenzar lectura");
      expect(cta(root).disabled).toBe(false);
      expect(root.textContent).not.toContain("Abrir lector");
      mounted?.unmount();
    }
  });

  it("las flechas del teclado cambian de opcion y mueven el foco", async () => {
    const onTimerTypeChange = vi.fn();
    const root = mount({ onTimerTypeChange });
    const first = radios(root)[0] as HTMLButtonElement;
    first.focus();
    await act(async () => {
      first.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    expect(onTimerTypeChange).toHaveBeenLastCalledWith("FREE");
    expect(radios(root)[1]?.getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(radios(root)[1]);
    expect(radios(root).map((r) => r.tabIndex)).toEqual([-1, 0]);
  });
});
