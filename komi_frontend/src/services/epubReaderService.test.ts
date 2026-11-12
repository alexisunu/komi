import { afterEach, describe, expect, it, vi } from "vitest";
import { createEpubReaderService, FONT_WAIT_MS, SETTLE_MS, type ReaderPosition } from "./epubReaderService";

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

function host(): HTMLElement {
  const element = document.createElement("div");
  element.getBoundingClientRect = () => ({ left: 24, width: 340, top: 0, height: 600 }) as DOMRect;
  return element;
}

const THEME = { theme: "light", fontPx: 18, fontBaseUrl: "https://komi.test/" } as const;

async function open(
  fake: ReturnType<typeof fakeBook>,
  over: { locations?: string | null; startCfi?: string | null; onCenterTap?: () => void } = {},
) {
  const positions: ReaderPosition[] = [];
  const service = createEpubReaderService({ openBook: async () => fake.book as never });
  const handle = await service.open({
    data: new ArrayBuffer(4),
    host: host(),
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
    doc.body.dispatchEvent(new MouseEvent("click", { clientX: 330, bubbles: true }));
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
    doc.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
    doc.dispatchEvent(new KeyboardEvent("keydown", { key: "x" }));
    expect(fake.rendition.next).toHaveBeenCalledTimes(1);
    expect(fake.rendition.prev).toHaveBeenCalledTimes(1);
  });
});
