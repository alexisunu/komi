import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { THEMES } from "../core/theme/colorTokens";
import { buildManifest, buildPwaOptions, ICON_PATHS, themeColorTags } from "./pwaConfig";

const publicDir = resolve(__dirname, "../../public");
const projectDir = resolve(__dirname, "../..");

function pngInfo(publicPath: string) {
  const buffer = readFileSync(resolve(publicDir, publicPath.replace(/^\//, "")));
  return {
    signature: buffer.subarray(0, 8).toString("hex"),
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    /** 2 = RGB y 6 = RGBA: un PNG con color tipo 6 puede traer transparencia. */
    colorType: buffer[25],
  };
}

describe("manifest", () => {
  const manifest = buildManifest();

  it("declara idioma, modo standalone, inicio y alcance", () => {
    expect(manifest).toMatchObject({
      name: "Komi",
      short_name: "Komi",
      lang: "es",
      display: "standalone",
      start_url: "/",
      scope: "/",
      id: "/",
    });
  });

  it("toma los colores de los tokens claros, sin hex propios", () => {
    expect(manifest.background_color).toBe(THEMES.light.brand["bg-primary"]);
    expect(manifest.theme_color).toBe(THEMES.light.brand["bg-primary"]);
  });

  it("lista los iconos de 192 y 512 'any' y uno maskable de 512", () => {
    expect(manifest.icons).toEqual([
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ]);
  });

  it("el maskable no se mezcla con 'any' en la misma entrada", () => {
    for (const icon of manifest.icons ?? []) {
      expect(icon.purpose).not.toContain(" ");
    }
  });
});

describe("iconos en disco", () => {
  const expected: Array<[string, number]> = [
    [ICON_PATHS.appleTouch, 180],
    [ICON_PATHS.small, 192],
    [ICON_PATHS.large, 512],
    [ICON_PATHS.maskable, 512],
  ];

  it.each(expected)("%s es un PNG cuadrado del tamano declarado", (path, size) => {
    const info = pngInfo(path);
    expect(info.signature).toBe("89504e470d0a1a0a");
    expect(info.width).toBe(size);
    expect(info.height).toBe(size);
  });

  it.each(expected)("%s es opaco (RGB, sin canal alfa)", (path) => {
    expect(pngInfo(path).colorType).toBe(2);
  });
});

describe("theme-color", () => {
  it("hay uno claro y uno oscuro con los bg-primary de cada tema", () => {
    expect(themeColorTags()).toEqual([
      { name: "theme-color", content: THEMES.light.brand["bg-primary"], media: "(prefers-color-scheme: light)" },
      { name: "theme-color", content: THEMES.dark.brand["bg-primary"], media: "(prefers-color-scheme: dark)" },
    ]);
  });
});

describe("Service Worker", () => {
  const options = buildPwaOptions();

  it("se actualiza solo y el registro lo hace la app", () => {
    expect(options.registerType).toBe("autoUpdate");
    expect(options.injectRegister).toBe(false);
  });

  it("precachea el shell y las fuentes", () => {
    const patterns = options.workbox?.globPatterns ?? [];
    expect(patterns.join(",")).toContain("html");
    expect(patterns.join(",")).toContain("js");
    expect(patterns.join(",")).toContain("css");
    expect(patterns.join(",")).toContain("woff2");
  });

  it("no cachea la API: sin runtimeCaching y con /api/ fuera del fallback de navegacion", () => {
    expect(options.workbox?.runtimeCaching).toBeUndefined();
    const denylist = options.workbox?.navigateFallbackDenylist ?? [];
    expect(denylist.some((re) => re.test("/api/v1/profile/onboarding/"))).toBe(true);
    expect(denylist.some((re) => re.test("/"))).toBe(false);
    expect(options.workbox?.navigateFallback).toBe("/index.html");
  });

  it("la version nueva toma el control sola (skipWaiting y clientsClaim)", () => {
    expect(options.workbox?.skipWaiting).toBe(true);
    expect(options.workbox?.clientsClaim).toBe(true);
  });

  it("limpia caches de versiones anteriores", () => {
    expect(options.workbox?.cleanupOutdatedCaches).toBe(true);
  });
});

describe("index.html (iOS)", () => {
  const html = readFileSync(resolve(projectDir, "index.html"), "utf8");

  it("habilita el modo app de iOS con barra de estado por defecto", () => {
    expect(html).toContain('name="apple-mobile-web-app-capable" content="yes"');
    expect(html).toContain('name="apple-mobile-web-app-status-bar-style" content="default"');
  });

  it("usa viewport-fit=cover para que env(safe-area-inset-bottom) funcione", () => {
    expect(html).toMatch(/name="viewport"[^>]*viewport-fit=cover/);
  });

  it("declara el idioma espanol", () => {
    expect(html).toContain('<html lang="es">');
  });
});
