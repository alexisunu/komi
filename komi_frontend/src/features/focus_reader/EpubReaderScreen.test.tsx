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
    early?: { actualSec: number; belowHalf: boolean } | null;
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
  const onAcceptEarly = vi.fn();
  const onCancel = vi.fn();
  const peek = vi.fn(() => (over.early === undefined ? { actualSec: 600, belowHalf: false } : over.early));
  const element = (theme: ThemeId, snapshot: FocusSnapshot, fontPx: ReaderFontSize) => (
    <EpubReaderScreen
      book={BOOK}
      snapshot={snapshot}
      reader={deps}
      wakeLock={lock as unknown as WakeLockService}
      theme={theme}
      fontPx={fontPx}
      onFontPx={onFontPx}
      peekEarlyFinish={peek}
      onAcceptEarly={onAcceptEarly}
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
    onAcceptEarly,
    onCancel,
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

  it("los botones de letra suben y bajan de 2 en 2 y se detienen en 16 y 22", async () => {
    const { root, onFontPx } = await mount({ fontPx: 18 });
    click(button(root, "Letra más grande"));
    expect(onFontPx).toHaveBeenLastCalledWith(20);
    click(button(root, "Letra más pequeña"));
    expect(onFontPx).toHaveBeenLastCalledWith(16);
    unmountNow();
    const small = await mount({ fontPx: 16 });
    expect(button(small.root, "Letra más pequeña")?.disabled).toBe(true);
    unmountNow();
    const big = await mount({ fontPx: 22 });
    expect(button(big.root, "Letra más grande")?.disabled).toBe(true);
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
      click(button(root, "Mostrar interfaz"));
      expect(root.querySelector(".epub-reader--immersive")).toBeNull();
      expect(fake.open).toHaveBeenCalledTimes(1);
    });

    it("el tercio central con la interfaz visible no hace nada; oculta, la devuelve", async () => {
      const { root, fake } = await mount();
      act(() => fake.inputs[0]?.onCenterTap?.());
      expect(root.querySelector(".epub-reader--immersive")).toBeNull();
      click(button(root, "Ocultar interfaz"));
      act(() => fake.inputs[0]?.onCenterTap?.());
      expect(root.querySelector(".epub-reader--immersive")).toBeNull();
      expect(root.querySelector(".epub-reader__header")).not.toBeNull();
    });

    it("el aviso de gracia se ve tambien con la interfaz oculta", async () => {
      const { root, rerender } = await mount();
      click(button(root, "Ocultar interfaz"));
      rerender("light", snap({ phase: "grace", graceRemainingMs: 9_100 }));
      expect(root.querySelector(".epub-reader--immersive .epub-reader__grace .grace-banner")).not.toBeNull();
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

  it("Terminé antes de tiempo con el 50 % acepta sin preguntar", async () => {
    const { root, onAcceptEarly } = await mount({ early: { actualSec: 450, belowHalf: false } });
    click(button(root, "Terminé antes de tiempo"));
    expect(onAcceptEarly).toHaveBeenCalledTimes(1);
  });

  it("solo usa tokens de color y no anima nada", () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\brgba?\(|\bhsla?\(/);
    expect(css).not.toContain("animation");
    expect(css).toContain("var(--screen-margin)"); // margenes laterales de 24 px
  });
});
