import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(__dirname, "SettingsPanel.css"), "utf8");

function rule(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `no se encontro ${selector}`).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf("}", start));
}

describe("SettingsPanel.css", () => {
  it("el velo usa el token derivado overlay (SRS 18, punto 25), no un color mezclado", () => {
    const backdrop = rule(".settings-backdrop");
    expect(backdrop).toContain("background: var(--color-derived-overlay);");
    expect(css).not.toContain("color-mix");
  });
});
