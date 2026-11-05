import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../core/theme/global.css";
import { ScreenPreview, type PreviewScreen } from "./ScreenPreview";

const root = document.getElementById("root");
if (!root) throw new Error("No se encontro el elemento #root");

const params = new URLSearchParams(window.location.search);
const themeParam = params.get("theme");
const theme = themeParam === "light" || themeParam === "dark" ? themeParam : null;

createRoot(root).render(
  <StrictMode>
    <ScreenPreview screen={(params.get("screen") ?? "garden") as PreviewScreen} theme={theme} />
  </StrictMode>,
);
