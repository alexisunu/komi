// Configuracion de la PWA como datos puros. vite.config.ts la importa; las pruebas la leen sin
// levantar Vite. Los colores salen de colorTokens.ts (SRS 18, punto 5): aqui no hay hex.

import type { ManifestOptions, VitePWAOptions } from "vite-plugin-pwa";
import { THEMES } from "../core/theme/colorTokens.ts";

export const APP_NAME = "Komi";
export const APP_DESCRIPTION = "Hábitos de lectura con calma: cada libro es un girasol que crece contigo.";

/** Rutas publicas de los iconos (los genera scripts/generate-icons.mjs). */
export const ICON_PATHS = {
  appleTouch: "/icons/apple-touch-icon-180.png",
  small: "/icons/icon-192.png",
  large: "/icons/icon-512.png",
  maskable: "/icons/icon-maskable-512.png",
} as const;

export interface ThemeColorTag {
  name: "theme-color";
  content: string;
  media: string;
}

/** Un `theme-color` por esquema del sistema; ThemeProvider los iguala si el lector elige a mano. */
export function themeColorTags(): ThemeColorTag[] {
  return [
    { name: "theme-color", content: THEMES.light.brand["bg-primary"], media: "(prefers-color-scheme: light)" },
    { name: "theme-color", content: THEMES.dark.brand["bg-primary"], media: "(prefers-color-scheme: dark)" },
  ];
}

export function buildManifest(): Partial<ManifestOptions> {
  const light = THEMES.light.brand;
  return {
    id: "/",
    name: APP_NAME,
    short_name: APP_NAME,
    description: APP_DESCRIPTION,
    lang: "es",
    dir: "ltr",
    display: "standalone",
    start_url: "/",
    scope: "/",
    // El manifest solo admite un valor: se usa el claro. El oscuro lo cubren los dos theme-color.
    background_color: light["bg-primary"],
    theme_color: light["bg-primary"],
    icons: [
      { src: ICON_PATHS.small, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: ICON_PATHS.large, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: ICON_PATHS.maskable, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

/**
 * Service Worker: se actualiza solo (`autoUpdate`) y precachea el shell y las fuentes. No hay
 * `runtimeCaching`: la API jamas pasa por la cache (lo exige SRS 18, punto 14).
 */
export function buildPwaOptions(): Partial<VitePWAOptions> {
  return {
    registerType: "autoUpdate",
    // El registro lo hace src/pwa/registerServiceWorker.ts, para poder aplazar la recarga.
    injectRegister: false,
    manifest: buildManifest(),
    includeAssets: [ICON_PATHS.appleTouch],
    workbox: {
      globPatterns: ["**/*.{js,css,html,woff2,png,svg,webmanifest}"],
      navigateFallback: "/index.html",
      navigateFallbackDenylist: [/^\/api\//],
      cleanupOutdatedCaches: true,
      // Con injectRegister en false el plugin ya no los activa solo: son lo que hace "auto".
      skipWaiting: true,
      clientsClaim: true,
    },
  };
}
