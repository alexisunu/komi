import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createEpubReaderService,
  FONT_WAIT_MS,
  PAGE_TURN_MS,
  TURN_VEIL_DIM_MS,
  SETTLE_MS,
  TURN_COMMIT_TIMEOUT_MS,
  type ReaderPosition,
} from "./epubReaderService";

// epubjs no dibuja paginas en jsdom: aqui se prueba la traduccion hacia y desde epubjs con un
// libro falso. El motor real se verifica a mano con libros reales (SRS 19.16).

type Handler = (...args: never[]) => void;
type Relocate = (location: { start: { cfi: string }; end: { cfi: string } }) => void;

type FakeFonts = { status: string; ready: Promise<unknown> };

function fakeBook(options: { locations: boolean; displayFails?: boolean; fonts?: FakeFonts[] }) {
  const handlers = new Map<string, Handler>();
  const contentHooks: Array<(contents: unknown) => void> = [];
  const rendition = {
    hooks: { content: { register: (fn: (contents: unknown) => void) => contentHooks.push(fn) } },
    on: (event: string, fn: Handler) => handlers.set(event, fn),
    themes: { registerCss: vi.fn(), select: vi.fn() },
    display: vi.fn(async (target?: string) => {
      if (options.displayFails && target) throw new Error("cfi invalido");
    }),
    getContents: vi.fn(() => (options.fonts ?? []).map((fonts) => ({ document: { fonts } }))),
    currentLocation: vi.fn(() => ({ start: { cfi: "pagina-actual" } })),
    next: vi.fn(async () => {}),
    prev: vi.fn(async () => {}),
    resize: vi.fn(),
    destroy: vi.fn(),
    getRange: vi.fn(() => ({
      setEnd: vi.fn(),
      endContainer: {},
      endOffset: 0,
      toString: () => "Texto de la pagina visible para la prueba.",
    })),
  };
  const book = {
    locations: {
      load: vi.fn(),
      length: () => (options.locations ? 10 : 0),
      percentageFromCfi: vi.fn((cfi: string) => (cfi === "fin" ? 0.4567 : 0.1)),
    },
    renderTo: vi.fn<(host: HTMLElement, options: object) => typeof rendition>(() => rendition),
    destroy: vi.fn(),
  };
  const relocate: Relocate = (location) => (handlers.get("relocated") as unknown as Relocate)(location);
  return { book, rendition, relocate, contentHooks };
}

function host(size?: { width: number; height: number }): HTMLElement {
  const element = document.createElement("div");
  if (size) {
    Object.defineProperty(element, "clientWidth", { get: () => size.width });
    Object.defineProperty(element, "clientHeight", { get: () => size.height });
  }
  element.getBoundingClientRect = () => ({ left: 24, width: 340, top: 0, height: 600 }) as DOMRect;
  return element;
}

const THEME = { theme: "light", fontPx: 18, fontBaseUrl: "https://komi.test/" } as const;

async function open(
  fake: ReturnType<typeof fakeBook>,
  over: {
    locations?: string | null;
    startCfi?: string | null;
    onCenterTap?: () => void;
    size?: { width: number; height: number };
    host?: HTMLElement;
  } = {},
) {
  const positions: ReaderPosition[] = [];
  const service = createEpubReaderService({ openBook: async () => fake.book as never });
  const handle = await service.open({
    data: new ArrayBuffer(4),
    host: over.host ?? host(over.size),
    locations: over.locations === undefined ? "[]" : over.locations,
    startCfi: over.startCfi ?? null,
    theme: THEME,
    onPosition: (p) => positions.push(p),
    ...(over.onCenterTap ? { onCenterTap: over.onCenterTap } : {}),
  });
  return { handle, positions };
}

const PAGE = { start: { cfi: "inicio" }, end: { cfi: "fin" } };

describe("epubReaderService.open", () => {
  it("no ejecuta scripts del libro, pagina y muestra una sola pagina", async () => {
    const fake = fakeBook({ locations: true });
    await open(fake);
    expect(fake.book.renderTo).toHaveBeenCalledTimes(1);
    expect(fake.book.renderTo.mock.calls[0]?.[1]).toMatchObject({
      allowScriptedContent: false,
      flow: "paginated",
      spread: "none",
    });
  });

  it("pide gap 0 a epubjs: el unico margen lateral es el del contenedor (24 px)", async () => {
    const fake = fakeBook({ locations: true });
    await open(fake);
    expect(fake.book.renderTo.mock.calls[0]?.[1]).toMatchObject({ gap: 0 });
  });

  it("carga las locations guardadas", async () => {
    const fake = fakeBook({ locations: true });
    await open(fake, { locations: '["a"]' });
    expect(fake.book.locations.load).toHaveBeenCalledWith('["a"]');
  });

  it("aplica el tema al abrir con el CSS generado desde los tokens", async () => {
    const fake = fakeBook({ locations: true });
    await open(fake);
    expect(fake.rendition.themes.registerCss).toHaveBeenCalledWith("komi", expect.stringContaining("Lora"));
    expect(fake.rendition.themes.select).toHaveBeenCalledWith("komi");
  });

  describe("cambio de tamano de letra", () => {
    afterEach(() => vi.useRealTimers());

    it("vuelve al CFI de la pagina vigente al instante y otra vez cuando el reflujo termino", async () => {
      vi.useFakeTimers();
      const fake = fakeBook({ locations: true });
      const { handle } = await open(fake);
      fake.rendition.display.mockClear();
      handle.setTheme({ theme: "light", fontPx: 22, fontBaseUrl: "https://komi.test/" });
      expect(fake.rendition.display).toHaveBeenCalledTimes(1);
      expect(fake.rendition.display).toHaveBeenLastCalledWith("pagina-actual");
      await vi.advanceTimersByTimeAsync(SETTLE_MS - 1);
      expect(fake.rendition.display).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(fake.rendition.display).toHaveBeenCalledTimes(2);
      expect(fake.rendition.display).toHaveBeenLastCalledWith("pagina-actual");
    });

    it("varios cambios seguidos vuelven siempre al mismo punto, aunque cada pagina empiece antes", async () => {
      vi.useFakeTimers();
      const fake = fakeBook({ locations: true });
      const { handle } = await open(fake);
      // Cada display(cfi) cae en una pagina que empieza antes: el inicio de la pagina vigente retrocede.
      let drift = 0;
      fake.rendition.display.mockImplementation(async () => {
        drift += 1;
        fake.rendition.currentLocation.mockReturnValue({ start: { cfi: `antes-${drift}` } } as never);
      });
      fake.rendition.display.mockClear();
      for (const px of [22, 18, 16, 20] as const) {
        handle.setTheme({ theme: "light", fontPx: px, fontBaseUrl: "https://komi.test/" });
        await vi.advanceTimersByTimeAsync(SETTLE_MS);
      }
      const targets = fake.rendition.display.mock.calls.map((call) => call[0]);
      expect(targets.length).toBe(8);
      expect(new Set(targets)).toEqual(new Set(["pagina-actual"]));
    });

    it("mientras dura el reacomodo, relocated guarda el punto de lectura y no el inicio de la pagina nueva", async () => {
      vi.useFakeTimers();
      const fake = fakeBook({ locations: true });
      const { handle, positions } = await open(fake);
      handle.setTheme({ theme: "light", fontPx: 22, fontBaseUrl: "https://komi.test/" });
      fake.relocate({ start: { cfi: "antes-1" }, end: { cfi: "fin" } });
      await vi.advanceTimersByTimeAsync(SETTLE_MS);
      fake.relocate({ start: { cfi: "antes-2" }, end: { cfi: "fin" } }); // fuente tardia
      expect(positions.map((p) => p.cfi)).toEqual(["pagina-actual", "pagina-actual"]);
    });

    it("pasar de pagina apaga la conservacion: el siguiente cambio parte de la pagina nueva", async () => {
      vi.useFakeTimers();
      const fake = fakeBook({ locations: true });
      const { handle, positions } = await open(fake);
      handle.setTheme({ theme: "light", fontPx: 22, fontBaseUrl: "https://komi.test/" });
      await vi.advanceTimersByTimeAsync(SETTLE_MS);
      await handle.next();
      fake.relocate({ start: { cfi: "pagina-siguiente" }, end: { cfi: "fin" } });
      expect(positions.at(-1)?.cfi).toBe("pagina-siguiente");
      fake.rendition.currentLocation.mockReturnValue({ start: { cfi: "pagina-siguiente" } } as never);
      fake.rendition.display.mockClear();
      handle.setTheme({ theme: "light", fontPx: 16, fontBaseUrl: "https://komi.test/" });
      expect(fake.rendition.display).toHaveBeenLastCalledWith("pagina-siguiente");
    });

    it("cambiar solo el tema (mismo tamano) no mueve la pagina", async () => {
      vi.useFakeTimers();
      const fake = fakeBook({ locations: true });
      const { handle } = await open(fake);
      fake.rendition.display.mockClear();
      handle.setTheme({ theme: "dark", fontPx: 18, fontBaseUrl: "https://komi.test/" });
      await vi.advanceTimersByTimeAsync(SETTLE_MS * 2);
      expect(fake.rendition.display).not.toHaveBeenCalled();
    });

    it("sin posicion todavia (epubjs aun no la tiene) cambia el tamano sin intentar volver", async () => {
      vi.useFakeTimers();
      const fake = fakeBook({ locations: true });
      fake.rendition.currentLocation.mockReturnValue(undefined as never);
      const { handle } = await open(fake);
      fake.rendition.display.mockClear();
      handle.setTheme({ theme: "light", fontPx: 20, fontBaseUrl: "https://komi.test/" });
      await vi.advanceTimersByTimeAsync(SETTLE_MS * 2);
      expect(fake.rendition.display).not.toHaveBeenCalled();
    });

    it("si volver al CFI falla, la lectura sigue sin error", async () => {
      vi.useFakeTimers();
      const fake = fakeBook({ locations: true });
      const { handle } = await open(fake);
      fake.rendition.display.mockRejectedValue(new Error("fallo"));
      expect(() => handle.setTheme({ theme: "light", fontPx: 16, fontBaseUrl: "https://komi.test/" })).not.toThrow();
      await vi.advanceTimersByTimeAsync(SETTLE_MS * 2);
    });
  });

  it("setTheme reaplica el CSS con el tema y tamano nuevos", async () => {
    const fake = fakeBook({ locations: true });
    const { handle } = await open(fake);
    handle.setTheme({ theme: "dark", fontPx: 22, fontBaseUrl: "https://komi.test/" });
    const css = fake.rendition.themes.registerCss.mock.calls.at(-1)?.[1] as string;
    expect(css).toContain("font-size:22px");
    expect(css).toContain("#181A18");
    expect(fake.rendition.themes.select).toHaveBeenCalledTimes(2);
  });

  it("abre en el CFI pedido y, si es invalido, desde el principio", async () => {
    const ok = fakeBook({ locations: true });
    await open(ok, { startCfi: "epubcfi(/6/4)" });
    expect(ok.rendition.display).toHaveBeenCalledWith("epubcfi(/6/4)");
    const bad = fakeBook({ locations: true, displayFails: true });
    await open(bad, { startCfi: "viejo" });
    expect(bad.rendition.display).toHaveBeenLastCalledWith();
  });

  describe("al reabrir espera a las fuentes (Lora, font-display swap)", () => {
    afterEach(() => vi.useRealTimers());

    it("fuentes aun cargando: espera y repite display con el mismo CFI", async () => {
      let done: () => void = () => {};
      const ready = new Promise<void>((resolve) => (done = resolve));
      const fake = fakeBook({ locations: true, fonts: [{ status: "loading", ready }] });
      const pending = open(fake, { startCfi: "epubcfi(/6/4)" });
      await Promise.resolve();
      expect(fake.rendition.display).toHaveBeenCalledTimes(1);
      done();
      await pending;
      expect(fake.rendition.display).toHaveBeenCalledTimes(2);
      expect(fake.rendition.display).toHaveBeenLastCalledWith("epubcfi(/6/4)");
    });

    it("fuentes ya cargadas: no repite display", async () => {
      const fake = fakeBook({ locations: true, fonts: [{ status: "loaded", ready: Promise.resolve() }] });
      await open(fake, { startCfi: "epubcfi(/6/4)" });
      expect(fake.rendition.display).toHaveBeenCalledTimes(1);
    });

    it("sin CFI (primera lectura) no espera ni repite", async () => {
      const fake = fakeBook({ locations: true, fonts: [{ status: "loading", ready: new Promise(() => {}) }] });
      await open(fake);
      expect(fake.rendition.display).toHaveBeenCalledTimes(1);
    });

    it("si las fuentes no llegan, sigue a los 2 s y repite display una vez", async () => {
      vi.useFakeTimers();
      const fake = fakeBook({ locations: true, fonts: [{ status: "loading", ready: new Promise(() => {}) }] });
      const pending = open(fake, { startCfi: "epubcfi(/6/4)" });
      await vi.advanceTimersByTimeAsync(FONT_WAIT_MS - 1);
      expect(fake.rendition.display).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(2);
      await pending;
      expect(fake.rendition.display).toHaveBeenCalledTimes(2);
    });

    it("con un CFI invalido (se abre desde el principio) no repite", async () => {
      const fake = fakeBook({
        locations: true,
        displayFails: true,
        fonts: [{ status: "loading", ready: Promise.resolve() }],
      });
      await open(fake, { startCfi: "viejo" });
      expect(fake.rendition.display).toHaveBeenCalledTimes(2);
      expect(fake.rendition.display).toHaveBeenLastCalledWith();
    });
  });

  it("relocated avisa el CFI del inicio, el texto visible y el porcentaje del FINAL de la pagina (truncado)", async () => {
    const fake = fakeBook({ locations: true });
    const { positions } = await open(fake);
    fake.relocate(PAGE);
    expect(positions).toEqual([
      { cfi: "inicio", percentage: 45.67, text: "Texto de la pagina visible para la prueba." },
    ]);
    expect(fake.book.locations.percentageFromCfi).toHaveBeenCalledWith("fin");
  });

  it("sin locations el porcentaje es nulo: nunca uno provisional", async () => {
    const fake = fakeBook({ locations: false });
    const { positions } = await open(fake, { locations: null });
    fake.relocate(PAGE);
    expect(positions[0]?.percentage).toBeNull();
    expect(fake.book.locations.percentageFromCfi).not.toHaveBeenCalled();
  });

  it("locations danadas: se lee sin porcentaje en vez de fallar", async () => {
    const fake = fakeBook({ locations: true });
    fake.book.locations.load.mockImplementation(() => {
      throw new Error("json roto");
    });
    const { positions } = await open(fake, { locations: "no es json" });
    fake.relocate(PAGE);
    expect(positions[0]?.percentage).toBeNull();
  });

  it("un rango que cruza de capitulo da texto vacio sin romper", async () => {
    const fake = fakeBook({ locations: true });
    fake.rendition.getRange.mockImplementation(() => {
      throw new Error("rango en otro documento");
    });
    const { positions } = await open(fake);
    fake.relocate(PAGE);
    expect(positions[0]).toMatchObject({ cfi: "inicio", text: "" });
  });

  it("destroy libera la rendicion y el libro, aunque la rendicion falle", async () => {
    const fake = fakeBook({ locations: true });
    const { handle } = await open(fake);
    fake.rendition.destroy.mockImplementation(() => {
      throw new Error("ya destruida");
    });
    expect(() => handle.destroy()).toThrow();
    expect(fake.book.destroy).toHaveBeenCalledTimes(1);
  });
});

describe("cambio de tamano del contenedor (ocultar o mostrar la interfaz)", () => {
  afterEach(() => vi.useRealTimers());
  const SIZE = { width: 360, height: 600 };

  async function openSized() {
    const fake = fakeBook({ locations: true });
    const size = { ...SIZE };
    const { handle, positions } = await open(fake, { size });
    fake.rendition.display.mockClear();
    return { fake, size, handle, positions };
  }

  it("con otro alto vuelve al punto de lectura al instante y otra vez al terminar el reflujo", async () => {
    vi.useFakeTimers();
    const { fake, size, handle } = await openSized();
    size.height = 680;
    handle.resize();
    expect(fake.rendition.resize).toHaveBeenLastCalledWith(360, 680);
    expect(fake.rendition.display).toHaveBeenCalledTimes(1);
    expect(fake.rendition.display).toHaveBeenLastCalledWith("pagina-actual");
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(fake.rendition.display).toHaveBeenCalledTimes(2);
  });

  it("ocultar y mostrar seguidos no retroceden aunque cada pagina empiece antes", async () => {
    vi.useFakeTimers();
    const { fake, size, handle } = await openSized();
    let drift = 0;
    fake.rendition.display.mockImplementation(async () => {
      drift += 1;
      fake.rendition.currentLocation.mockReturnValue({ start: { cfi: `antes-${drift}` } } as never);
    });
    for (const height of [680, 600, 680, 600]) {
      size.height = height;
      handle.resize();
      await vi.advanceTimersByTimeAsync(SETTLE_MS);
    }
    const targets = fake.rendition.display.mock.calls.map((call) => call[0]);
    expect(targets.length).toBe(8);
    expect(new Set(targets)).toEqual(new Set(["pagina-actual"]));
  });

  it("el aviso inicial del observador (mismo tamano) no vuelve a mostrar la pagina", async () => {
    vi.useFakeTimers();
    const { fake, handle } = await openSized();
    handle.resize();
    await vi.advanceTimersByTimeAsync(SETTLE_MS * 2);
    expect(fake.rendition.resize).toHaveBeenCalledTimes(1);
    expect(fake.rendition.display).not.toHaveBeenCalled();
  });

  it("mientras dura el reacomodo, relocated guarda el punto y no el inicio de la pagina nueva", async () => {
    vi.useFakeTimers();
    const { fake, size, handle, positions } = await openSized();
    size.height = 680;
    handle.resize();
    fake.relocate({ start: { cfi: "antes-1" }, end: { cfi: "fin" } });
    expect(positions.at(-1)?.cfi).toBe("pagina-actual");
  });

  it("pasar de pagina apaga el ancla: el siguiente cambio parte de la pagina nueva", async () => {
    vi.useFakeTimers();
    const { fake, size, handle } = await openSized();
    size.height = 680;
    handle.resize();
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    await handle.next();
    fake.rendition.currentLocation.mockReturnValue({ start: { cfi: "pagina-siguiente" } } as never);
    fake.rendition.display.mockClear();
    size.height = 600;
    handle.resize();
    expect(fake.rendition.display).toHaveBeenLastCalledWith("pagina-siguiente");
  });

  it("letra y alto intercalados comparten el ancla", async () => {
    vi.useFakeTimers();
    const { fake, size, handle } = await openSized();
    fake.rendition.currentLocation.mockReturnValue({ start: { cfi: "otra-pagina" } } as never);
    handle.setTheme({ theme: "light", fontPx: 22, fontBaseUrl: "https://komi.test/" });
    size.height = 680;
    handle.resize();
    const targets = fake.rendition.display.mock.calls.map((call) => call[0]);
    expect(new Set(targets)).toEqual(new Set(["otra-pagina"]));
  });

  it("sin posicion todavia, o si volver falla, el cambio de alto no rompe la lectura", async () => {
    vi.useFakeTimers();
    const { fake, size, handle } = await openSized();
    fake.rendition.currentLocation.mockReturnValue(undefined as never);
    size.height = 680;
    handle.resize();
    expect(fake.rendition.display).not.toHaveBeenCalled();
    fake.rendition.currentLocation.mockReturnValue({ start: { cfi: "p" } } as never);
    fake.rendition.display.mockRejectedValue(new Error("fallo"));
    size.height = 600;
    expect(() => handle.resize()).not.toThrow();
    await vi.advanceTimersByTimeAsync(SETTLE_MS * 2);
  });
});

describe("giro de pagina animado", () => {
  const W = 312;
  type Anim = { finished: Promise<void>; resolve: () => void; finish: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> };
  let anims: Anim[] = [];
  let frames: Array<FrameRequestCallback | null> = [];
  let animate: ReturnType<typeof vi.fn>;
  let reduced = false;
  /** Animaciones por giro: vista, velo (movimiento), velo (atenuacion) y borde con sombra. */
  const PER_TURN = 4;

  beforeEach(() => {
    anims = [];
    frames = [];
    reduced = false;
    animate = vi.fn(() => {
      let resolve = () => {};
      const finished = new Promise<void>((r) => (resolve = r));
      const anim: Anim = { finished, resolve, finish: vi.fn(() => resolve()), cancel: vi.fn() };
      anims.push(anim);
      return anim;
    });
    (HTMLElement.prototype as unknown as { animate: unknown }).animate = animate;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      frames[id - 1] = null;
    });
    window.matchMedia = vi.fn(() => ({ matches: reduced })) as unknown as typeof window.matchMedia;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
  });

  const flush = () => vi.advanceTimersByTimeAsync(0);
  const runFrame = () => {
    const list = frames;
    frames = [];
    list.forEach((cb) => cb?.(0));
  };

  /** Contenedor de epubjs falso: `left` es el scrollLeft, que el giro cambia con retraso. */
  async function openTurn(over: { left?: number; total?: number } = {}) {
    const fake = fakeBook({ locations: true });
    const hostEl = host({ width: W, height: 560 });
    const container = document.createElement("div");
    container.className = "epub-container";
    container.appendChild(Object.assign(document.createElement("div"), { className: "epub-view" }));
    hostEl.appendChild(container);
    const state = { left: over.left ?? W, total: over.total ?? 5 * W };
    Object.defineProperty(container, "offsetWidth", { get: () => W });
    Object.defineProperty(container, "scrollWidth", { get: () => state.total });
    Object.defineProperty(container, "scrollLeft", { get: () => state.left, set: (v: number) => (state.left = v) });
    // epubjs aplica el scroll despues de la llamada (cola interna), no en el mismo turno.
    const turnBy = (delta: number) => async () => {
      await Promise.resolve();
      state.left += delta;
    };
    fake.rendition.next.mockImplementation(turnBy(W));
    fake.rendition.prev.mockImplementation(turnBy(-W));
    const { handle, positions } = await open(fake, { host: hostEl });
    fake.rendition.display.mockClear();
    const veil = () => hostEl.querySelector(".epub-reader__turn-veil");
    return { fake, handle, positions, state, veil, container };
  }

  it("avanzar dentro del capitulo anima 320 ms ease-out solo con transform y opacity, y pide el giro al terminar", async () => {
    const t = await openTurn();
    const done = t.handle.next();
    await flush();
    expect(animate).toHaveBeenCalledTimes(PER_TURN);
    const slide = [{ transform: "translateX(0)" }, { transform: `translateX(${-W}px)` }];
    const [viewKeys, viewTiming] = animate.mock.calls[0] as [Keyframe[], KeyframeAnimationOptions];
    expect(viewKeys).toEqual(slide);
    expect(viewTiming).toMatchObject({ duration: 320, easing: "ease-out" });
    // El velo viaja con la pagina que sale y su atenuacion llega al maximo en el 40 % del giro.
    expect((animate.mock.calls[1] as [Keyframe[]])[0]).toEqual(slide);
    const [dimKeys, dimTiming] = animate.mock.calls[2] as [Keyframe[], KeyframeAnimationOptions];
    expect(dimKeys).toEqual([{ opacity: 0 }, { opacity: 0.4 }]);
    expect(dimTiming).toMatchObject({ duration: TURN_VEIL_DIM_MS, easing: "ease-out" });
    expect(TURN_VEIL_DIM_MS).toBe(128);
    // El borde con sombra de la pagina que entra viaja igual; solo transform y opacity.
    expect((animate.mock.calls[3] as [Keyframe[]])[0]).toEqual(slide);
    for (const [keys] of animate.mock.calls as Array<[Array<Record<string, unknown>>]>) {
      for (const frame of keys) expect(Object.keys(frame).every((k) => k === "transform" || k === "opacity")).toBe(true);
    }
    expect(t.veil()).not.toBeNull();
    expect(t.container.parentElement?.querySelector(".epub-reader__turn-layer .epub-reader__turn-edge--after")).not.toBeNull();
    // Mientras dura el movimiento no se pide el giro: el progreso aun no cambia.
    expect(t.fake.rendition.next).not.toHaveBeenCalled();
    anims[0]?.resolve();
    await flush();
    expect(t.fake.rendition.next).toHaveBeenCalledTimes(1);
    runFrame(); // el rAF ve el cambio de scroll y limpia antes de pintar
    await done;
    expect(anims.every((a) => a.cancel.mock.calls.length === 1)).toBe(true);
    expect(t.veil()).toBeNull();
    expect(t.state.left).toBe(2 * W);
  });

  it("retroceder desliza en sentido contrario", async () => {
    const t = await openTurn({ left: 2 * W });
    const done = t.handle.prev();
    await flush();
    const [viewKeys] = animate.mock.calls[0] as [Keyframe[]];
    expect(viewKeys[1]).toEqual({ transform: `translateX(${W}px)` });
    // La pagina que entra viene por la izquierda: su borde con sombra va antes de la pagina.
    expect(t.container.parentElement?.querySelector(".epub-reader__turn-edge--before")).not.toBeNull();
    anims[0]?.resolve();
    await flush();
    expect(t.fake.rendition.prev).toHaveBeenCalledTimes(1);
    runFrame();
    await done;
    expect(t.state.left).toBe(W);
  });

  it("limpia animacion, velo y transform en el fotograma que ve el cambio, sin esperar a la promesa", async () => {
    const t = await openTurn();
    t.fake.rendition.next.mockImplementation(async () => {
      t.state.left += W;
      await new Promise(() => {}); // la promesa nunca se resuelve
    });
    const done = t.handle.next();
    await flush();
    anims[0]?.resolve();
    await flush();
    expect(t.veil()).not.toBeNull(); // aun retenido: el scroll no se ha visto
    t.state.left = 2 * W; // (ya aplicado por epubjs)
    runFrame();
    await done;
    expect(t.veil()).toBeNull();
    expect(anims.every((a) => a.cancel.mock.calls.length === 1)).toBe(true);
  });

  describe("toques seguidos (solo un toque aislado se anima)", () => {
    it("un toque durante el giro lo completa al instante y es instantaneo; no se salta ninguna pagina", async () => {
      const t = await openTurn({ left: W, total: 8 * W });
      let applyFirst = () => {};
      t.fake.rendition.next.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            applyFirst = () => {
              t.state.left += W;
              resolve();
            };
          }),
      );
      const first = t.handle.next();
      await flush();
      expect(animate).toHaveBeenCalledTimes(PER_TURN); // vista, velo (2) y borde del primero
      const second = t.handle.next(); // toque durante el movimiento
      await flush();
      expect(anims[0]?.finish).toHaveBeenCalled(); // completa la actual
      expect(t.fake.rendition.next).toHaveBeenCalledTimes(1);
      // El giro pendiente aun no se aplico: el segundo espera, no predice ni anima.
      expect(animate).toHaveBeenCalledTimes(PER_TURN);
      applyFirst();
      await flush();
      await first;
      await second;
      expect(animate).toHaveBeenCalledTimes(PER_TURN); // el segundo fue instantaneo
      expect(t.fake.rendition.next).toHaveBeenCalledTimes(2);
      expect(t.state.left).toBe(3 * W); // ni una pagina saltada ni repetida
      expect(t.veil()).toBeNull();
    });

    it("una rafaga de 4 toques anima solo el primero y avanza 4 paginas", async () => {
      const t = await openTurn({ left: W, total: 9 * W });
      const turns = [t.handle.next()];
      await flush();
      for (let i = 0; i < 3; i++) {
        turns.push(t.handle.next());
        await vi.advanceTimersByTimeAsync(80);
      }
      runFrame();
      await Promise.all(turns);
      expect(animate).toHaveBeenCalledTimes(PER_TURN); // una sola animacion
      expect(t.fake.rendition.next).toHaveBeenCalledTimes(4);
      expect(t.state.left).toBe(5 * W);
      expect(t.veil()).toBeNull();
      expect(anims.every((a) => a.cancel.mock.calls.length === 1)).toBe(true);
    });

    it("los toques de una rafaga que llegan con un giro instantaneo pendiente tambien son instantaneos", async () => {
      const t = await openTurn({ left: W, total: 9 * W });
      let applySecond = () => {};
      const first = t.handle.next();
      await flush();
      anims[0]?.resolve();
      await flush();
      runFrame();
      await first;
      await vi.advanceTimersByTimeAsync(PAGE_TURN_MS); // pasada la rafaga: el siguiente toque es aislado
      // Giro pendiente (aun sin aplicar): lo que llegue ahora no se anima.
      t.fake.rendition.next.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            applySecond = () => {
              t.state.left += W;
              resolve();
            };
          }),
      );
      const second = t.handle.next(); // aislado: se anima
      await flush();
      const calls = animate.mock.calls.length;
      const third = t.handle.next(); // con el segundo en curso
      await flush();
      anims[PER_TURN]?.resolve();
      await flush();
      applySecond();
      await flush();
      runFrame();
      await Promise.all([second, third]);
      expect(animate.mock.calls.length).toBe(calls); // el tercero no animo
    });

    it("un toque a menos de un giro del anterior sigue en la rafaga aunque el giro previo ya se aplico", async () => {
      const t = await openTurn({ left: W, total: 9 * W });
      const first = t.handle.next();
      await flush();
      const second = t.handle.next(); // corta al primero: ambos se aplican en pocos ms
      await vi.advanceTimersByTimeAsync(100); // la cola ya esta vacia, pero no paso un giro
      const third = t.handle.next();
      await flush();
      runFrame();
      await Promise.all([first, second, third]);
      expect(animate).toHaveBeenCalledTimes(PER_TURN); // solo el primero se animo
      expect(t.state.left).toBe(4 * W);
    });

    it("con la rafaga agotada, el siguiente toque vuelve a animarse", async () => {
      const t = await openTurn({ left: W, total: 9 * W });
      const turns = [t.handle.next(), t.handle.next()];
      await flush();
      runFrame();
      await Promise.all(turns);
      expect(animate).toHaveBeenCalledTimes(PER_TURN);
      await vi.advanceTimersByTimeAsync(PAGE_TURN_MS); // pasada la rafaga
      const next = t.handle.next(); // aislado otra vez
      await flush();
      expect(animate).toHaveBeenCalledTimes(2 * PER_TURN);
      anims[PER_TURN]?.resolve();
      await flush();
      runFrame();
      await next;
      expect(t.state.left).toBe(4 * W);
    });

    it("pasar de pagina tambien apaga el ancla del reflujo con toques seguidos", async () => {
      const t = await openTurn();
      t.handle.setTheme({ theme: "light", fontPx: 22, fontBaseUrl: "https://komi.test/" });
      await flush();
      const done = t.handle.next();
      await flush();
      t.fake.relocate({ start: { cfi: "pagina-siguiente" }, end: { cfi: "fin" } });
      expect(t.positions.at(-1)?.cfi).toBe("pagina-siguiente");
      anims[0]?.resolve();
      await flush();
      runFrame();
      await done;
    });
  });

  describe("primera y ultima pagina", () => {
    it("retroceder en la primera pagina no anima ni deja transform", async () => {
      const t = await openTurn({ left: 0 });
      t.fake.rendition.prev.mockImplementation(async () => {}); // epubjs: no hay nada atras
      await t.handle.prev();
      expect(animate).not.toHaveBeenCalled();
      expect(t.veil()).toBeNull();
      expect(t.fake.rendition.prev).toHaveBeenCalledTimes(1);
    });

    it("avanzar en la ultima pagina no anima ni deja transform", async () => {
      const t = await openTurn({ left: 4 * W, total: 5 * W });
      t.fake.rendition.next.mockImplementation(async () => {});
      await t.handle.next();
      expect(animate).not.toHaveBeenCalled();
      expect(t.veil()).toBeNull();
    });
  });

  describe("prediccion equivocada", () => {
    it("si el giro cruza de capitulo, limpia en cuanto el scroll vuelve a 0, sin esperar el respaldo", async () => {
      const t = await openTurn();
      t.fake.rendition.next.mockImplementation(async () => {
        t.state.left = 0; // epubjs cambio de capitulo
        t.state.total = 3 * W;
        await new Promise(() => {});
      });
      const done = t.handle.next();
      await flush();
      anims[0]?.resolve();
      await flush();
      expect(t.veil()).not.toBeNull();
      runFrame();
      await done; // se resuelve sin avanzar el reloj hasta el respaldo
      expect(t.veil()).toBeNull();
      expect(anims.every((a) => a.cancel.mock.calls.length === 1)).toBe(true);
    });

    it("si el cambio nunca se ve, el respaldo de 1 s limpia: nunca queda una pagina retenida", async () => {
      const t = await openTurn();
      t.fake.rendition.next.mockImplementation(() => new Promise(() => {}));
      const done = t.handle.next();
      await flush();
      anims[0]?.resolve();
      await flush();
      await vi.advanceTimersByTimeAsync(TURN_COMMIT_TIMEOUT_MS);
      await done;
      expect(t.veil()).toBeNull();
    });

    it("si la pestana no avanza las animaciones, el respaldo tras los 320 ms pide el giro igual", async () => {
      const t = await openTurn();
      const done = t.handle.next();
      await flush();
      await vi.advanceTimersByTimeAsync(PAGE_TURN_MS + 250); // `finished` nunca se resolvio
      expect(t.fake.rendition.next).toHaveBeenCalledTimes(1);
      runFrame();
      await done;
    });
  });

  it("con movimiento reducido el cambio es instantaneo", async () => {
    reduced = true;
    const t = await openTurn();
    await t.handle.next();
    expect(animate).not.toHaveBeenCalled();
    expect(t.fake.rendition.next).toHaveBeenCalledTimes(1);
  });

  it("sin API de animaciones (o sin contenedor de epubjs) el cambio es instantaneo", async () => {
    delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
    const t = await openTurn();
    await t.handle.next();
    expect(t.fake.rendition.next).toHaveBeenCalledTimes(1);
    const bare = fakeBook({ locations: true });
    const { handle } = await open(bare); // host sin .epub-container
    await handle.next();
    expect(bare.rendition.next).toHaveBeenCalledTimes(1);
  });

  it("cambiar la letra a mitad de giro limpia el transform ANTES de anotar el punto y descarta el giro", async () => {
    const t = await openTurn();
    void t.handle.next();
    await flush();
    t.fake.rendition.display.mockClear();
    t.handle.setTheme({ theme: "light", fontPx: 22, fontBaseUrl: "https://komi.test/" });
    expect(t.veil()).toBeNull();
    expect(anims.every((a) => a.cancel.mock.calls.length === 1)).toBe(true);
    const cancelOrder = anims[0]?.cancel.mock.invocationCallOrder[0] ?? Infinity;
    const lookOrder = t.fake.rendition.currentLocation.mock.invocationCallOrder[0] ?? 0;
    expect(cancelOrder).toBeLessThan(lookOrder);
    anims[0]?.resolve();
    await vi.advanceTimersByTimeAsync(PAGE_TURN_MS * 2);
    expect(t.fake.rendition.next).not.toHaveBeenCalled(); // el giro descartado no se pide despues
  });

  it("cambiar el alto a mitad de giro tambien lo descarta y limpia", async () => {
    const fake = fakeBook({ locations: true });
    const size = { width: W, height: 560 };
    const hostEl = host(size);
    const container = document.createElement("div");
    container.className = "epub-container";
    container.appendChild(Object.assign(document.createElement("div"), { className: "epub-view" }));
    hostEl.appendChild(container);
    Object.defineProperty(container, "offsetWidth", { get: () => W });
    Object.defineProperty(container, "scrollWidth", { get: () => 5 * W });
    Object.defineProperty(container, "scrollLeft", { get: () => W });
    const { handle } = await open(fake, { host: hostEl, size });
    void handle.next();
    await flush();
    size.height = 640;
    handle.resize();
    expect(hostEl.querySelector(".epub-reader__turn-veil")).toBeNull();
    expect(anims.every((a) => a.cancel.mock.calls.length === 1)).toBe(true);
  });

  it("destruir el lector limpia un giro en curso", async () => {
    const t = await openTurn();
    void t.handle.next();
    await flush();
    t.handle.destroy();
    expect(t.veil()).toBeNull();
  });
});

describe("tema en cada capitulo nuevo", () => {
  function chapterContents() {
    const doc = document.implementation.createHTMLDocument("capitulo");
    return {
      document: doc,
      window: { frameElement: { getBoundingClientRect: () => ({ left: 0 }) } },
      addStylesheetCss: vi.fn((css: string, key: string) => css !== "" && key !== ""),
    };
  }

  it("inyecta el CSS de Komi al crear el capitulo, antes de mostrarlo (sin destello ni reflujo)", async () => {
    const fake = fakeBook({ locations: true });
    await open(fake);
    const first = chapterContents();
    fake.contentHooks.forEach((hook) => hook(first));
    expect(first.addStylesheetCss).toHaveBeenCalledWith(expect.stringContaining("#F7F5F0"), "komi");
  });

  it("tras cambiar el tema, los capitulos siguientes nacen con el tema nuevo", async () => {
    const fake = fakeBook({ locations: true });
    const { handle } = await open(fake);
    handle.setTheme({ theme: "dark", fontPx: 22, fontBaseUrl: "https://komi.test/" });
    const next = chapterContents();
    fake.contentHooks.forEach((hook) => hook(next));
    const css = next.addStylesheetCss.mock.calls[0]?.[0] as string;
    expect(css).toContain("#181A18");
    expect(css).toContain("font-size:22px");
  });
});

describe("idioma del capitulo (separacion silabica)", () => {
  async function chapter(bookLanguage: string | undefined, chapterLang?: string) {
    const fake = fakeBook({ locations: true });
    (fake.book as Record<string, unknown>)["packaging"] = { metadata: { language: bookLanguage } };
    await open(fake);
    const doc = document.implementation.createHTMLDocument("capitulo");
    if (chapterLang) doc.documentElement.setAttribute("lang", chapterLang);
    fake.contentHooks.forEach((hook) =>
      hook({
        document: doc,
        window: { frameElement: { getBoundingClientRect: () => ({ left: 0 }) } },
        addStylesheetCss: () => true,
      }),
    );
    return doc.documentElement.getAttribute("lang");
  }

  it("usa dc:language del libro, respeta el del capitulo y cae en es", async () => {
    expect(await chapter("en")).toBe("en");
    expect(await chapter("en", "fr")).toBe("fr");
    expect(await chapter(undefined)).toBe("es");
  });
});

describe("gestos dentro del iframe", () => {
  async function withContents(frameLeft: number) {
    const fake = fakeBook({ locations: true });
    await open(fake);
    const doc = document.implementation.createHTMLDocument("capitulo");
    const contents = {
      document: doc,
      window: { frameElement: { getBoundingClientRect: () => ({ left: frameLeft }) } },
      addStylesheetCss: vi.fn(() => true),
    };
    fake.contentHooks.forEach((hook) => hook(contents));
    return { fake, doc };
  }

  it("un toque en el tercio derecho de la pantalla pasa de pagina aunque el iframe este desplazado", async () => {
    // Contenedor en x=24 de 340 px; el iframe esta corrido una pagina: su borde izquierdo queda en 24-340.
    const { fake, doc } = await withContents(24 - 340);
    doc.body.dispatchEvent(new MouseEvent("click", { clientX: 340 + 300, bubbles: true }));
    expect(fake.rendition.next).toHaveBeenCalledTimes(1);
    expect(fake.rendition.prev).not.toHaveBeenCalled();
  });

  it("el tercio izquierdo vuelve atras y el centro avisa a la pantalla sin pasar de pagina", async () => {
    const { fake, doc } = await withContents(24 - 340);
    doc.body.dispatchEvent(new MouseEvent("click", { clientX: 340 + 20, bubbles: true }));
    expect(fake.rendition.prev).toHaveBeenCalledTimes(1);
    doc.body.dispatchEvent(new MouseEvent("click", { clientX: 340 + 170, bubbles: true }));
    expect(fake.rendition.next).not.toHaveBeenCalled();
    expect(fake.rendition.prev).toHaveBeenCalledTimes(1);
  });

  it("el tercio central avisa con onCenterTap y no pasa de pagina; izquierda y derecha no lo avisan", async () => {
    const onCenterTap = vi.fn();
    const fake = fakeBook({ locations: true });
    await open(fake, { onCenterTap });
    const doc = document.implementation.createHTMLDocument("capitulo");
    const contents = {
      document: doc,
      window: { frameElement: { getBoundingClientRect: () => ({ left: 24 }) } },
      addStylesheetCss: vi.fn((css: string, key: string) => css !== "" && key !== ""),
    };
    fake.contentHooks.forEach((hook) => hook(contents));
    doc.body.dispatchEvent(new MouseEvent("click", { clientX: 170, bubbles: true }));
    expect(onCenterTap).toHaveBeenCalledTimes(1);
    expect(fake.rendition.next).not.toHaveBeenCalled();
    expect(fake.rendition.prev).not.toHaveBeenCalled();
    doc.body.dispatchEvent(new MouseEvent("click", { clientX: 20, bubbles: true }));
    await new Promise((r) => setTimeout(r, 0)); // los giros se encadenan: el segundo espera al primero
    doc.body.dispatchEvent(new MouseEvent("click", { clientX: 330, bubbles: true }));
    await new Promise((r) => setTimeout(r, 0)); // dentro de una rafaga el giro espera a la cola
    expect(onCenterTap).toHaveBeenCalledTimes(1);
    expect(fake.rendition.prev).toHaveBeenCalledTimes(1);
    expect(fake.rendition.next).toHaveBeenCalledTimes(1);
  });

  it("el tercio central sin onCenterTap no rompe", async () => {
    const fake = fakeBook({ locations: true });
    await open(fake);
    const doc = document.implementation.createHTMLDocument("capitulo");
    const contents = {
      document: doc,
      window: { frameElement: { getBoundingClientRect: () => ({ left: 24 }) } },
      addStylesheetCss: vi.fn((css: string, key: string) => css !== "" && key !== ""),
    };
    fake.contentHooks.forEach((hook) => hook(contents));
    expect(() => doc.body.dispatchEvent(new MouseEvent("click", { clientX: 170, bubbles: true }))).not.toThrow();
  });

  it("un enlace del libro tiene prioridad sobre el toque", async () => {
    const { fake, doc } = await withContents(24);
    const link = doc.createElement("a");
    link.setAttribute("href", "#nota");
    doc.body.appendChild(link);
    link.dispatchEvent(new MouseEvent("click", { clientX: 320, bubbles: true }));
    expect(fake.rendition.next).not.toHaveBeenCalled();
  });

  it("las flechas del teclado pasan de pagina", async () => {
    const { fake, doc } = await withContents(24);
    doc.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    await new Promise((r) => setTimeout(r, 0)); // los giros se encadenan: el segundo espera al primero
    doc.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
    doc.dispatchEvent(new KeyboardEvent("keydown", { key: "x" }));
    await new Promise((r) => setTimeout(r, 0));
    expect(fake.rendition.next).toHaveBeenCalledTimes(1);
    expect(fake.rendition.prev).toHaveBeenCalledTimes(1);
  });
});
