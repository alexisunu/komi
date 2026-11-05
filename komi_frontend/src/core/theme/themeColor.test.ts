import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { THEMES } from "./colorTokens";
import { syncThemeColor } from "./themeColor";

function addMeta(content: string, media?: string) {
  const meta = document.createElement("meta");
  meta.setAttribute("name", "theme-color");
  meta.setAttribute("content", content);
  if (media) meta.setAttribute("media", media);
  document.head.appendChild(meta);
  return meta;
}

describe("syncThemeColor", () => {
  let metas: HTMLMetaElement[];

  beforeEach(() => {
    metas = [
      addMeta("x", "(prefers-color-scheme: light)"),
      addMeta("y", "(prefers-color-scheme: dark)"),
    ];
  });
  afterEach(() => metas.forEach((m) => m.remove()));

  it("iguala todos los theme-color al bg-primary del tema oscuro", () => {
    syncThemeColor("dark");
    for (const meta of metas) expect(meta.getAttribute("content")).toBe(THEMES.dark.brand["bg-primary"]);
  });

  it("iguala todos al del tema claro", () => {
    syncThemeColor("light");
    for (const meta of metas) expect(meta.getAttribute("content")).toBe(THEMES.light.brand["bg-primary"]);
  });

  it("conserva el atributo media de cada etiqueta", () => {
    syncThemeColor("dark");
    expect(metas[0]?.getAttribute("media")).toBe("(prefers-color-scheme: light)");
  });

  it("no toca otras etiquetas meta", () => {
    const other = document.createElement("meta");
    other.setAttribute("name", "description");
    other.setAttribute("content", "intacto");
    document.head.appendChild(other);
    syncThemeColor("dark");
    expect(other.getAttribute("content")).toBe("intacto");
    other.remove();
  });
});
