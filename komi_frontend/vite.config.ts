import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { defineConfig, type Plugin } from "vitest/config";
import { buildThemeCss } from "./src/core/theme/themeCss.ts";
import { buildPwaOptions, ICON_PATHS, themeColorTags } from "./src/pwa/pwaConfig.ts";

// Inserta las variables CSS de los tokens en el <head> para que la primera pintura ya tenga
// el tema correcto. Los tokens viven solo en src/core/theme (CLAUDE.md 5).
function themeCssPlugin(): Plugin {
  return {
    name: "komi-theme-css",
    transformIndexHtml() {
      return [
        {
          tag: "style",
          attrs: { "data-komi-theme": "" },
          children: buildThemeCss(),
          injectTo: "head-prepend",
        },
        // theme-color para claro y oscuro, desde los tokens (nada de hex aqui).
        ...themeColorTags().map((attrs) => ({ tag: "meta", attrs: { ...attrs }, injectTo: "head" as const })),
        { tag: "link", attrs: { rel: "apple-touch-icon", sizes: "180x180", href: ICON_PATHS.appleTouch }, injectTo: "head" as const },
        { tag: "link", attrs: { rel: "icon", type: "image/png", sizes: "192x192", href: ICON_PATHS.small }, injectTo: "head" as const },
      ];
    },
  };
}

// La PWA (manifest, theme-color y Service Worker) sale de src/pwa/pwaConfig.ts.
export default defineConfig({
  plugins: [react(), themeCssPlugin(), VitePWA(buildPwaOptions())],
  test: {
    environment: "jsdom",
    passWithNoTests: true,
    css: true,
  },
});
