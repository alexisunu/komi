import { describe, expect, it } from "vitest";
import {
  FULL_HUNDREDTHS,
  fromHundredths,
  pageProgressHundredths,
  toHundredths,
  truncateProgress,
} from "./progressMath";

describe("pageProgressHundredths (libro fisico)", () => {
  it("trunca a 2 decimales, no redondea (como ROUND_DOWN del servidor)", () => {
    expect(pageProgressHundredths(1, 3)).toBe(3333); // 33.333...
    expect(pageProgressHundredths(2, 3)).toBe(6666); // 66.666... (redondeado seria 6667)
    expect(pageProgressHundredths(120, 264)).toBe(4545); // 45.4545...
  });

  it("el 100% solo se alcanza en la ultima pagina", () => {
    expect(pageProgressHundredths(9_999, 10_000)).toBe(9_999);
    expect(pageProgressHundredths(99_999, 100_000)).toBe(9_999); // 99.999 no es 100
    expect(pageProgressHundredths(264, 264)).toBe(FULL_HUNDREDTHS);
  });

  it("pagina 0 es 0%", () => {
    expect(pageProgressHundredths(0, 250)).toBe(0);
  });
});

describe("truncateProgress (EPUB)", () => {
  it("trunca a 2 decimales", () => {
    expect(truncateProgress(33.339)).toBe(33.33);
    expect(truncateProgress(29.999)).toBe(29.99);
    expect(truncateProgress(99.999)).toBe(99.99);
  });

  it("no pierde un centesimo por ruido binario (0.29 * 100 = 28.999999999999996)", () => {
    expect(truncateProgress(0.29)).toBe(0.29);
    expect(truncateProgress(1.15)).toBe(1.15);
    expect(truncateProgress(4.35)).toBe(4.35);
  });

  it("limita a 0..100", () => {
    expect(truncateProgress(-5)).toBe(0);
    expect(truncateProgress(100.7)).toBe(100);
  });
});

describe("centesimas", () => {
  it("ida y vuelta sin error de coma flotante", () => {
    for (const hundredths of [0, 1, 29, 3333, 4545, 9999, 10000]) {
      expect(toHundredths(fromHundredths(hundredths))).toBe(hundredths);
    }
  });
});
