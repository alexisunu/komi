import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../core/theme/global.css";
import { Gallery } from "./Gallery";

const root = document.getElementById("root");
if (!root) throw new Error("No se encontro el elemento #root");

createRoot(root).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
);
