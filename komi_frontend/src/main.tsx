import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Workbox } from "workbox-window";
import { App } from "./App";
import "./core/theme/global.css";
import { registerServiceWorker } from "./pwa/registerServiceWorker";
import { reloadGate } from "./pwa/reloadGate";

const root = document.getElementById("root");
if (!root) throw new Error("No se encontro el elemento #root");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// El Service Worker solo existe en la version de produccion (npm run build / preview).
if (import.meta.env.PROD) {
  void registerServiceWorker({
    supported: "serviceWorker" in navigator,
    create: () => new Workbox("/sw.js", { scope: "/" }),
    gate: reloadGate,
  });
}
