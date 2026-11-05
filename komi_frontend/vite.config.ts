import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vitest/config";
import { buildThemeCss } from "./src/core/theme/themeCss.ts";

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
      ];
    },
  };
}

// La configuracion de la PWA (vite-plugin-pwa) se agrega en el bloque 8 del Sprint 3.
export default defineConfig({
  plugins: [react(), themeCssPlugin()],
  test: {
    environment: "jsdom",
    passWithNoTests: true,
    css: true,
  },
});
