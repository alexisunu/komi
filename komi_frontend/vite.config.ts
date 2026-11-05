import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// La configuracion de la PWA (vite-plugin-pwa) se agrega en el bloque 8 del Sprint 3.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    passWithNoTests: true,
  },
});
