import { describe, expect, it } from "vitest";
import { KOMOREBI, TSUKIMI } from "../core/theme/colorTokens";
import { keyAction, SWIPE_MIN_PX, swipeAction, tapAction, toHostX } from "./readerGestures";
import {
  buildReaderCss,
  DEFAULT_FONT_SIZE,
  FONT_SIZES,
  isFontSize,
  READER_LINE_HEIGHT,
  READER_MARGIN_PX,
  stepFontSize,
} from "./readerTheme";

const base = { fontBaseUrl: "https://komi.test/" };

describe("buildReaderCss", () => {
  it("usa los tokens del tema claro", () => {
    const css = buildReaderCss({ theme: "light", fontPx: 18, ...base });
    expect(css).toContain(KOMOREBI.brand["bg-primary"]);
    expect(css).toContain(KOMOREBI.brand["text-primary"]);
    expect(css).not.toContain(TSUKIMI.brand["bg-primary"]);
  });

  it("usa los tokens del tema oscuro y cambia al reaplicar", () => {
    const dark = buildReaderCss({ theme: "dark", fontPx: 18, ...base });
    expect(dark).toContain(TSUKIMI.brand["bg-primary"]);
    expect(dark).toContain(TSUKIMI.brand["text-primary"]);
    expect(dark).not.toContain(KOMOREBI.brand["text-primary"]);
  });

  it("Lora, interlineado 1,6 y el tamano pedido", () => {
    const css = buildReaderCss({ theme: "light", fontPx: 20, ...base });
    expect(css).toContain('font-family:"Lora"');
    expect(css).toContain(`line-height:${READER_LINE_HEIGHT} !important`);
    expect(READER_LINE_HEIGHT).toBe(1.6);
    expect(css).toContain("font-size:20px !important");
  });

  it("carga Lora desde el origen de la app (el iframe no resuelve rutas relativas)", () => {
    const css = buildReaderCss({ theme: "light", fontPx: 18, fontBaseUrl: "https://komi.test" });
    expect(css).toContain("https://komi.test/fonts/Lora/Lora-Variable.woff2");
    expect(css).toContain("https://komi.test/fonts/Lora/Lora-Italic-Variable.woff2");
  });

  it("no usa negro ni blanco puros y los unicos hex son tokens", () => {
    const tokens = new Set(
      [KOMOREBI, TSUKIMI].flatMap((t) => Object.values(t.brand).map((v) => v.toUpperCase())),
    );
    for (const theme of ["light", "dark"] as const) {
      const css = buildReaderCss({ theme, fontPx: 18, ...base });
      for (const hex of css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []) {
        expect(tokens.has(hex.toUpperCase())).toBe(true);
      }
      expect(css).not.toMatch(/#000000|#FFFFFF|#000\b|#FFF\b/i);
    }
  });

  it("las imagenes no se salen de la pagina", () => {
    expect(buildReaderCss({ theme: "light", fontPx: 18, ...base })).toContain("max-width:100%");
  });
});

describe("tamano de letra", () => {
  it("va de 16 a 22 px en pasos de 2 y 18 por defecto", () => {
    expect([...FONT_SIZES]).toEqual([16, 18, 20, 22]);
    expect(DEFAULT_FONT_SIZE).toBe(18);
    expect(READER_MARGIN_PX).toBe(24);
  });

  it("stepFontSize se detiene en los extremos", () => {
    expect(stepFontSize(18, "larger")).toBe(20);
    expect(stepFontSize(22, "larger")).toBe(22);
    expect(stepFontSize(18, "smaller")).toBe(16);
    expect(stepFontSize(16, "smaller")).toBe(16);
  });

  it("isFontSize valida lo guardado", () => {
    expect(isFontSize(20)).toBe(true);
    expect(isFontSize(19)).toBe(false);
    expect(isFontSize("18")).toBe(false);
    expect(isFontSize(null)).toBe(false);
  });
});

describe("gestos", () => {
  it("tercios del toque: atras, nada, adelante", () => {
    expect(tapAction(10, 300)).toBe("prev");
    expect(tapAction(99, 300)).toBe("prev");
    expect(tapAction(150, 300)).toBeNull();
    expect(tapAction(201, 300)).toBe("next");
    expect(tapAction(290, 300)).toBe("next");
  });

  it("toHostX: en la 2.a pagina el iframe esta desplazado y el tercio sigue siendo el de la pantalla", () => {
    // Contenedor visible de 340 px en x=24. El iframe mide 3 paginas y esta corrido 1 pagina a la izquierda.
    const hostLeft = 24;
    const frameLeft = hostLeft - 340;
    // Toque en el tercio derecho de la pantalla (300 px dentro del contenedor): clientX dentro del iframe = 340 + 300.
    const clientX = 340 + 300;
    const x = toHostX(clientX, frameLeft, hostLeft);
    expect(x).toBe(300);
    expect(tapAction(x, 340)).toBe("next");
    // Con el ancho del iframe (1020) como referencia el mismo toque caia en el centro: el error que se corrige.
    expect(tapAction(clientX, 1020)).toBeNull();
    expect(tapAction(toHostX(340 + 20, frameLeft, hostLeft), 340)).toBe("prev");
  });

  it("entradas invalidas no pasan de pagina", () => {
    expect(tapAction(10, 0)).toBeNull();
    expect(tapAction(Number.NaN, 300)).toBeNull();
  });

  it("deslizar: izquierda es siguiente, derecha es anterior", () => {
    expect(swipeAction(-80, 5)).toBe("next");
    expect(swipeAction(80, -5)).toBe("prev");
  });

  it("un deslizamiento corto o mas vertical que horizontal se ignora", () => {
    expect(swipeAction(-(SWIPE_MIN_PX - 1), 0)).toBeNull();
    expect(swipeAction(-60, 60)).toBeNull();
    expect(swipeAction(-60, 30)).toBe("next");
  });

  it("teclas", () => {
    expect(keyAction("ArrowRight")).toBe("next");
    expect(keyAction(" ")).toBe("next");
    expect(keyAction("ArrowLeft")).toBe("prev");
    expect(keyAction("a")).toBeNull();
  });
});
