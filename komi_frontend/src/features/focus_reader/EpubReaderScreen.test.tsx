import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LocalBook, LocalEpubFile } from "../../data/local_db/types";
import type { FocusSnapshot } from "../../services/focusVisibilityService";
import type { ReaderFontSize } from "../../services/readerTheme";
import type { WakeLockService } from "../../services/wakeLockService";
import type { ThemeId } from "../../core/theme/colorTokens";
import { createFakeReader } from "../../test/readerEnv";
import { click, render } from "../../test/render";
import css from "./EpubReaderScreen.css?raw";
import menuCss from "./ReaderMenu.css?raw";
import { EpubReaderScreen } from "./EpubReaderScreen";
import type { EpubReaderDeps } from "./useEpubReader";

let mounted: ReturnType<typeof render> | null = null;
afterEach(() => {
  unmountNow();
  document.body.innerHTML = "";
});

function unmountNow() {
  mounted?.unmount();
  mounted = null;
}

const BOOK: LocalBook = {
  id: "b",
  title: "Kokoro",
  author: "Natsume Soseki",
  format_type: "EPUB",
  sunflower_variant: "CLASSIC",
  status: "ACTIVE",
  total_pages: null,
  current_page: 0,
  progress_percentage: 12,
  last_epub_cfi: null,
  created_at: "2026-11-01T00:00:00.000Z",
  completed_at: null,
  updated_at: "2026-11-01T00:00:00.000Z",
  pending_sync: 0,
};

const FILE: LocalEpubFile = {
  book_id: "b",
  data: new Uint8Array([1]).buffer,
  size_bytes: 1,
  locations: "[]",
  created_at: "2026-11-01T00:00:00.000Z",
};

function snap(over: Partial<FocusSnapshot> = {}): FocusSnapshot {
  return {
    phase: "running",
    remainingMs: 754_200,
    elapsedMs: 145_800,
    plannedSec: 900,
    graceRemainingMs: 0,
    actualSec: null,
    sessionId: "s",
    bookId: "b",
    ...over,
  };
}

const settle = () => act(async () => new Promise((r) => setTimeout(r, 20)));
const button = (root: ParentNode, label: string) =>
  [...root.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === label || b.getAttribute("aria-label") === label,
  ) as HTMLButtonElement | undefined;

async function mount(
  over: {
    theme?: ThemeId;
    fontPx?: ReaderFontSize;
    snapshot?: FocusSnapshot;
    file?: LocalEpubFile | undefined;
    open?: () => Promise<never>;
    early?: { actualSec: number; enough: boolean } | null;
  } = {},
) {
  const fake = createFakeReader();
  if (over.open) fake.open.mockImplementation(over.open);
  const lock = { acquire: vi.fn(async () => {}), release: vi.fn(async () => {}) };
  const deps: EpubReaderDeps = {
    reader: fake.reader,
    files: { getFile: async () => ("file" in over ? over.file : FILE) },
    progress: {
      load: async () => null,
      save: vi.fn(async () => {}),
      loadPosition: async () => null,
      savePosition: vi.fn(async () => {}),
    },
    now: () => 1_000,
  };
  const onFontPx = vi.fn();
  const onToggleTheme = vi.fn();
  const onTalkRequested = vi.fn();
  const onFinish = vi.fn();
  const onCancel = vi.fn();
  const peek = vi.fn(() => (over.early === undefined ? { actualSec: 600, enough: true } : over.early));
  const element = (theme: ThemeId, snapshot: FocusSnapshot, fontPx: ReaderFontSize) => (
    <EpubReaderScreen
      book={BOOK}
      snapshot={snapshot}
      reader={deps}
      wakeLock={lock as unknown as WakeLockService}
      theme={theme}
      onToggleTheme={onToggleTheme}
      onTalkRequested={onTalkRequested}
      fontPx={fontPx}
      onFontPx={onFontPx}
      peekFinish={peek}
      onFinish={onFinish}
      onCancel={onCancel}
    />
  );
  mounted = render(element(over.theme ?? "light", over.snapshot ?? snap(), over.fontPx ?? 18));
  await settle();
  return {
    root: mounted.container,
    fake,
    lock,
    onFontPx,
    onToggleTheme,
    onTalkRequested,
    onFinish,
    onCancel,
    peek,
    rerender: (theme: ThemeId, snapshot = over.snapshot ?? snap(), fontPx: ReaderFontSize = over.fontPx ?? 18) =>
      mounted?.rerender(element(theme, snapshot, fontPx)),
  };
}

describe("EpubReaderScreen", () => {
  it("encabezado con el reloj, la pagina del libro y el pie: 3 bloques y sin navegacion", async () => {
    const { root } = await mount();
    expect(root.querySelectorAll("[data-block]")).toHaveLength(3);
    expect(root.querySelector('.epub-reader__header [role="timer"]')?.textContent).toBe("12:35");
    expect(root.querySelector(".bottom-nav")).toBeNull();
    expect(root.querySelector(".epub-reader__host")).not.toBeNull();
  });

  it("abre el libro con el archivo y las locations del dispositivo, y pide la pantalla encendida", async () => {
    const { fake, lock } = await mount();
    expect(fake.open).toHaveBeenCalledTimes(1);
    expect(fake.inputs[0]).toMatchObject({ locations: "[]", startCfi: null });
    expect(fake.inputs[0]?.data).toBe(FILE.data);
    expect(lock.acquire).toHaveBeenCalledTimes(1);
  });

  it("al desmontar libera el lector y la pantalla", async () => {
    const { fake, lock } = await mount();
    unmountNow();
    expect(fake.handle.destroy).toHaveBeenCalledTimes(1);
    expect(lock.release).toHaveBeenCalledTimes(1);
  });

  it("el tema se pasa al abrir y se REAPLICA al cambiar, sin reabrir el libro", async () => {
    const { fake, rerender } = await mount({ theme: "light" });
    expect(fake.inputs[0]?.theme.theme).toBe("light");
    rerender("dark");
    expect(fake.handle.setTheme).toHaveBeenLastCalledWith(expect.objectContaining({ theme: "dark", fontPx: 18 }));
    rerender("light");
    expect(fake.handle.setTheme).toHaveBeenLastCalledWith(expect.objectContaining({ theme: "light" }));
    expect(fake.open).toHaveBeenCalledTimes(1);
  });

  it("un re-render con el mismo tema NO reinyecta el CSS (evita reflujo en cada pagina)", async () => {
    const { fake, rerender } = await mount({ theme: "dark", fontPx: 18 });
    const before = fake.handle.setTheme.mock.calls.length;
    rerender("dark", snap(), 18);
    rerender("dark", snap(), 18);
    expect(fake.handle.setTheme.mock.calls.length).toBe(before);
  });

  it("el tamano de letra tambien se reaplica", async () => {
    const { fake, rerender } = await mount();
    rerender("light", snap(), 22);
    expect(fake.handle.setTheme).toHaveBeenLastCalledWith(expect.objectContaining({ fontPx: 22 }));
  });

  it("el boton T abre el selector con las cuatro medidas y marca la actual", async () => {
    const { root } = await mount({ fontPx: 20 });
    expect(document.querySelector('[role="radiogroup"]')).toBeNull();
    click(button(root, "Tamaño de letra"));
    const options = [...document.querySelectorAll('[role="radio"]')];
    expect(options.map((o) => o.getAttribute("aria-label"))).toEqual([
      "16 píxeles",
      "18 píxeles",
      "20 píxeles",
      "22 píxeles",
    ]);
    expect(options.map((o) => o.getAttribute("aria-checked"))).toEqual(["false", "false", "true", "false"]);
  });

  it("elegir una medida la aplica y deja el selector abierto", async () => {
    const { root, onFontPx } = await mount({ fontPx: 18 });
    click(button(root, "Tamaño de letra"));
    click(document.querySelector('[aria-label="22 píxeles"]'));
    expect(onFontPx).toHaveBeenCalledWith(22);
    expect(document.querySelector('[role="radiogroup"]')).not.toBeNull();
  });

  it("el selector se cierra con Escape", async () => {
    const { root } = await mount();
    click(button(root, "Tamaño de letra"));
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(document.querySelector('[role="radiogroup"]')).toBeNull();
  });

  it("ya no hay botones de letra mas grande o mas pequena en el encabezado", async () => {
    const { root } = await mount();
    expect(button(root, "Letra más grande")).toBeUndefined();
    expect(button(root, "Letra más pequeña")).toBeUndefined();
  });

  it("los botones de pagina llaman al lector", async () => {
    const { root, fake } = await mount();
    click(button(root, "Página siguiente"));
    click(button(root, "Página anterior"));
    expect(fake.handle.next).toHaveBeenCalledTimes(1);
    expect(fake.handle.prev).toHaveBeenCalledTimes(1);
  });

  it("subtitulo del modo y avance: el porcentaje solo aparece cuando existe", async () => {
    const { root, fake } = await mount();
    const subtitle = () => root.querySelector(".epub-reader__percent")?.textContent?.replace(/\s+/g, " ").trim();
    expect(subtitle()).toBe("Temporizador");
    await act(async () => fake.see({ cfi: "c", percentage: 33.7, text: "" }));
    expect(subtitle()).toBe("Temporizador · 33 %");
    await act(async () => fake.see({ cfi: "d", percentage: null, text: "" }));
    expect(subtitle()).toBe("Temporizador · 33 %"); // no se borra ni se inventa
  });

  it("en gracia el aviso es una superposicion flotante, fuera del encabezado y del flujo", async () => {
    const { root } = await mount({ snapshot: snap({ phase: "grace", graceRemainingMs: 9_100 }) });
    const banner = root.querySelector(".epub-reader__grace .grace-banner");
    expect(banner?.textContent).toContain("10 s");
    expect(root.querySelector(".epub-reader__header .grace-banner")).toBeNull();
  });

  describe("interfaz oculta", () => {
    it("empieza visible: cabecera, pagina y pie, sin linea de progreso ni boton flotante", async () => {
      const { root } = await mount();
      expect(root.querySelector(".epub-reader--immersive")).toBeNull();
      expect(root.querySelector(".epub-reader__header")).not.toBeNull();
      expect(root.querySelector(".epub-reader__footer")).not.toBeNull();
      expect(root.querySelector(".epub-reader__progress")).toBeNull();
      expect(root.querySelector(".epub-reader__float")).toBeNull();
    });

    it("Ocultar interfaz deja solo el texto, la linea de progreso y el boton flotante", async () => {
      const { root, fake } = await mount();
      await act(async () => fake.see({ cfi: "c", percentage: 40, text: "" }));
      click(button(root, "Ocultar interfaz"));
      expect(root.querySelector(".epub-reader--immersive")).not.toBeNull();
      expect(root.querySelector(".epub-reader__header")).toBeNull();
      expect(root.querySelector(".epub-reader__footer")).toBeNull();
      expect(root.querySelector(".epub-reader__page")).not.toBeNull();
      const line = root.querySelector('.epub-reader__progress[role="progressbar"]');
      expect(line?.getAttribute("aria-valuenow")).toBe("40");
      const fill = root.querySelector<HTMLElement>(".epub-reader__progress-fill");
      expect(fill?.style.transform).toBe("scaleX(0.4)");
      expect(root.querySelector(".epub-reader__float")).not.toBeNull();
    });

    it("la linea de progreso no existe si el libro no tiene locations (nunca uno inventado)", async () => {
      const { root } = await mount();
      click(button(root, "Ocultar interfaz"));
      expect(root.querySelector(".epub-reader__progress")).toBeNull();
    });

    it("el libro no se reabre al ocultar o mostrar la interfaz", async () => {
      const { root, fake } = await mount();
      click(button(root, "Ocultar interfaz"));
      click(button(root, "Abrir menú"));
      click(button(root, "Mostrar interfaz"));
      expect(root.querySelector(".epub-reader--immersive")).toBeNull();
      expect(fake.open).toHaveBeenCalledTimes(1);
    });

    it("el tercio central con la interfaz visible no hace nada; oculta, abre el menu", async () => {
      const { root, fake } = await mount();
      act(() => fake.inputs[0]?.onCenterTap?.());
      expect(root.querySelector(".epub-reader--immersive")).toBeNull();
      expect(root.querySelector(".reader-menu")).toBeNull();
      click(button(root, "Ocultar interfaz"));
      act(() => fake.inputs[0]?.onCenterTap?.());
      expect(root.querySelector(".epub-reader--immersive")).not.toBeNull();
      expect(root.querySelector(".reader-menu")).not.toBeNull();
    });

    it("el aviso de gracia se ve tambien con la interfaz oculta", async () => {
      const { root, rerender } = await mount();
      click(button(root, "Ocultar interfaz"));
      rerender("light", snap({ phase: "grace", graceRemainingMs: 9_100 }));
      expect(root.querySelector(".epub-reader--immersive .epub-reader__grace .grace-banner")).not.toBeNull();
    });
  });

  describe("menu flotante", () => {
    const labels = (root: ParentNode) =>
      [...root.querySelectorAll(".reader-menu__item")].map((item) => item.textContent?.trim());

    async function hidden(over: Parameters<typeof mount>[0] = {}) {
      const ctx = await mount(over);
      click(button(ctx.root, "Ocultar interfaz"));
      return ctx;
    }

    it("el boton flotante lo abre y se vuelve la X que lo cierra", async () => {
      const { root } = await hidden();
      expect(root.querySelector(".reader-menu")).toBeNull();
      const float = button(root, "Abrir menú");
      expect(float?.getAttribute("aria-expanded")).toBe("false");
      click(float);
      expect(root.querySelector(".reader-menu")).not.toBeNull();
      expect(button(root, "Cerrar menú")?.getAttribute("aria-expanded")).toBe("true");
      click(button(root, "Cerrar menú"));
      expect(root.querySelector(".reader-menu")).toBeNull();
      expect(root.querySelector(".epub-reader--immersive")).not.toBeNull();
    });

    it("tiene exactamente las cinco acciones, en orden", async () => {
      const { root } = await hidden();
      click(button(root, "Abrir menú"));
      expect(labels(root)).toEqual([
        "Hablar con Komi",
        "Terminar sesión",
        "Tamaño de letra",
        "Modo noche",
        "Mostrar interfaz",
      ]);
    });

    it("en oscuro la tercera accion de tema dice Modo dia", async () => {
      const { root } = await hidden({ theme: "dark" });
      click(button(root, "Abrir menú"));
      expect(labels(root)).toContain("Modo día");
      expect(labels(root)).not.toContain("Modo noche");
    });

    it("tocar la veladura cierra el menu y no pasa de pagina", async () => {
      const { root, fake } = await hidden();
      click(button(root, "Abrir menú"));
      click(root.querySelector(".reader-menu__veil"));
      expect(root.querySelector(".reader-menu")).toBeNull();
      expect(fake.handle.next).not.toHaveBeenCalled();
      expect(fake.handle.prev).not.toHaveBeenCalled();
    });

    it("Escape cierra el menu", async () => {
      const { root } = await hidden();
      click(button(root, "Abrir menú"));
      act(() => {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      });
      expect(root.querySelector(".reader-menu")).toBeNull();
    });

    it("al abrir el foco va a la primera accion y al cerrar vuelve al boton flotante", async () => {
      const { root } = await hidden();
      const float = button(root, "Abrir menú");
      float?.focus();
      click(float);
      expect(document.activeElement?.textContent?.trim()).toBe("Hablar con Komi");
      act(() => {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      });
      expect(document.activeElement).toBe(float);
    });

    it("Modo noche cambia el tema de la app y cierra el menu", async () => {
      const { root, onToggleTheme } = await hidden();
      click(button(root, "Abrir menú"));
      click(button(root, "Modo noche"));
      expect(onToggleTheme).toHaveBeenCalledTimes(1);
      expect(root.querySelector(".reader-menu")).toBeNull();
      expect(root.querySelector(".epub-reader--immersive")).not.toBeNull();
    });

    it("Tamaño de letra del menu cierra el menu y abre el selector sin mostrar la interfaz", async () => {
      const { root } = await hidden();
      click(button(root, "Abrir menú"));
      click(button(root, "Tamaño de letra"));
      expect(root.querySelector(".reader-menu")).toBeNull();
      expect(document.querySelector('[role="radiogroup"]')).not.toBeNull();
      expect(root.querySelector(".epub-reader--immersive")).not.toBeNull();
    });

    it("Hablar con Komi con el tiempo cumplido avisa y acepta el cierre, en ese orden", async () => {
      const ctx = await hidden({ early: { actualSec: 600, enough: true } });
      const order: string[] = [];
      ctx.onTalkRequested.mockImplementation(() => order.push("talk"));
      ctx.onFinish.mockImplementation(() => order.push("accept"));
      click(button(ctx.root, "Abrir menú"));
      click(button(ctx.root, "Hablar con Komi"));
      expect(order).toEqual(["talk", "accept"]);
      expect(ctx.root.querySelector(".reader-menu")).toBeNull();
    });

    it("Hablar con Komi con menos de 5 minutos pide el aviso y no avisa de la charla", async () => {
      const ctx = await hidden({ early: { actualSec: 100, enough: false } });
      click(button(ctx.root, "Abrir menú"));
      click(button(ctx.root, "Hablar con Komi"));
      expect(ctx.onTalkRequested).not.toHaveBeenCalled();
      expect(ctx.onFinish).not.toHaveBeenCalled();
      expect(document.querySelector('[role="dialog"]')?.textContent).toContain("¿Terminar sin guardar?");
    });

    it("Terminar sesion no avisa de la charla", async () => {
      const ctx = await hidden({ early: { actualSec: 600, enough: true } });
      click(button(ctx.root, "Abrir menú"));
      click(button(ctx.root, "Terminar sesión"));
      expect(ctx.onFinish).toHaveBeenCalledTimes(1);
      expect(ctx.onTalkRequested).not.toHaveBeenCalled();
    });

    it("Mostrar interfaz cierra el menu y devuelve la cabecera y el pie", async () => {
      const { root } = await hidden();
      click(button(root, "Abrir menú"));
      click(button(root, "Mostrar interfaz"));
      expect(root.querySelector(".reader-menu")).toBeNull();
      expect(root.querySelector(".epub-reader--immersive")).toBeNull();
      expect(root.querySelector(".epub-reader__header")).not.toBeNull();
      expect(root.querySelector(".epub-reader__footer")).not.toBeNull();
    });

    it("Terminar sesion del menu usa la regla unica: con 5 minutos termina y con menos muestra el aviso", async () => {
      const ok = await hidden({ early: { actualSec: 600, enough: true } });
      click(button(ok.root, "Abrir menú"));
      click(button(ok.root, "Terminar sesión"));
      expect(ok.onFinish).toHaveBeenCalledTimes(1);
      unmountNow();
      document.body.innerHTML = "";

      const low = await hidden({ early: { actualSec: 100, enough: false } });
      click(button(low.root, "Abrir menú"));
      click(button(low.root, "Terminar sesión"));
      expect(low.onFinish).not.toHaveBeenCalled();
      expect(document.querySelector('[role="dialog"]')?.textContent).toContain("El tiempo mínimo es 5 min");
    });

    it("el aviso de gracia queda por encima de la veladura (capas del CSS)", () => {
      const z = (selector: string, source: string) =>
        Number(new RegExp(`${selector}\\s*\\{[^}]*?z-index:\\s*(\\d+)`).exec(source)?.[1]);
      expect(z("\\.reader-menu__veil", menuCss)).toBeLessThan(z("\\.reader-menu", menuCss));
      expect(z("\\.reader-menu", menuCss)).toBeLessThan(z("\\.epub-reader__grace", css));
      expect(z("\\.epub-reader__grace", css)).toBeLessThan(z("\\.epub-reader__float", css));
    });
  });

  it("sin archivo: aviso en terracota y Salir sin guardar", async () => {
    const { root, onCancel, fake } = await mount({ file: undefined });
    expect(root.querySelector('[role="alert"]')?.textContent).toContain("ya no está en el dispositivo");
    expect(fake.open).not.toHaveBeenCalled();
    expect(button(root, "Página siguiente")?.disabled).toBe(true);
    click(button(root, "Salir sin guardar"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("si el libro no se puede abrir, avisa en vez de quedar en blanco", async () => {
    const { root } = await mount({
      open: async () => {
        throw new Error("zip danado");
      },
    });
    expect(root.querySelector('[role="alert"]')?.textContent).toContain("No pudimos abrir este libro");
  });

  it("Terminar sesion del pie con 5 minutos o mas termina directo, sin confirmacion", async () => {
    const { root, onFinish } = await mount({ early: { actualSec: 300, enough: true } });
    click(button(root, "Terminar sesión"));
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("el pie tiene solo tres controles, en orden: pagina anterior, Terminar sesion, pagina siguiente", async () => {
    const { root } = await mount();
    const labels = [...root.querySelectorAll(".epub-reader__footer button")].map(
      (b) => b.getAttribute("aria-label") ?? b.textContent?.trim(),
    );
    expect(labels).toEqual(["Página anterior", "Terminar sesión", "Página siguiente"]);
    expect(button(root, "Terminé antes de tiempo")).toBeUndefined();
  });

  describe("aviso de menos de 5 minutos", () => {
    const SHORT = { early: { actualSec: 100, enough: false } };
    const dialog = () => document.querySelector('[role="dialog"]');

    it("aparece con menos de 5 minutos, con el motivo claro, y no termina nada", async () => {
      const { root, onFinish, onCancel } = await mount(SHORT);
      click(button(root, "Terminar sesión"));
      expect(onFinish).not.toHaveBeenCalled();
      expect(onCancel).not.toHaveBeenCalled();
      expect(dialog()?.textContent).toContain("¿Terminar sin guardar?");
      expect(dialog()?.textContent).toContain("El tiempo mínimo es 5 min");
      expect(dialog()?.textContent).not.toContain("mitad");
    });

    it("Seguir leyendo es la accion principal y Descartar la secundaria", async () => {
      const { root } = await mount(SHORT);
      click(button(root, "Terminar sesión"));
      const keep = button(document.body, "Seguir leyendo") as HTMLButtonElement;
      const drop = button(document.body, "Descartar") as HTMLButtonElement;
      expect(keep.className).not.toContain("secondary");
      expect(drop.className).toContain("secondary");
      expect(button(document.body, "Cancelar sesión")).toBeUndefined();
    });

    it("Seguir leyendo cierra el aviso y no termina ni descarta", async () => {
      const { root, onFinish, onCancel } = await mount(SHORT);
      click(button(root, "Terminar sesión"));
      click(button(document.body, "Seguir leyendo"));
      expect(dialog()).toBeNull();
      expect(onFinish).not.toHaveBeenCalled();
      expect(onCancel).not.toHaveBeenCalled();
    });

    it("Descartar sale sin guardar: llama a onCancel y nunca a onFinish", async () => {
      const { root, onFinish, onCancel } = await mount(SHORT);
      click(button(root, "Terminar sesión"));
      click(button(document.body, "Descartar"));
      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(onFinish).not.toHaveBeenCalled();
      expect(dialog()).toBeNull();
    });

    it("no aparece si la sesion lleva el libro al 100 %: se guarda directo", async () => {
      const { root, fake, onFinish } = await mount(SHORT);
      await act(async () => fake.see({ cfi: "fin", percentage: 100, text: "" }));
      click(button(root, "Terminar sesión"));
      expect(dialog()).toBeNull();
      expect(onFinish).toHaveBeenCalledTimes(1);
    });

    it("99,99 % no cuenta como libro terminado: aparece el aviso", async () => {
      const { root, fake, onFinish } = await mount(SHORT);
      await act(async () => fake.see({ cfi: "casi", percentage: 99.99, text: "" }));
      click(button(root, "Terminar sesión"));
      expect(dialog()).not.toBeNull();
      expect(onFinish).not.toHaveBeenCalled();
    });

    it("sin porcentaje conocido no se puede afirmar que termino: aparece el aviso", async () => {
      const { root, onFinish } = await mount(SHORT);
      click(button(root, "Terminar sesión"));
      expect(dialog()).not.toBeNull();
      expect(onFinish).not.toHaveBeenCalled();
    });

    it("aunque el tiempo siga corriendo con el aviso abierto, Descartar no guarda nada", async () => {
      const ctx = await mount(SHORT);
      click(button(ctx.root, "Terminar sesión"));
      ctx.peek.mockReturnValue({ actualSec: 400, enough: true });
      click(button(document.body, "Descartar"));
      expect(ctx.onCancel).toHaveBeenCalledTimes(1);
      expect(ctx.onFinish).not.toHaveBeenCalled();
    });
  });

  it("solo usa tokens de color y no anima nada", () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\brgba?\(|\bhsla?\(/);
    expect(css).not.toContain("animation");
    expect(css).toContain("var(--screen-margin)"); // margenes laterales de 24 px
  });
});
