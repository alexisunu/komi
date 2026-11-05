// @vitest-environment node
import { build } from "vite";
import { describe, expect, it } from "vitest";
import gallerySource from "./Gallery.tsx?raw";
import { GALLERY_MARKER } from "./Gallery.tsx";

// La galeria es solo para desarrollo: el build de produccion no debe incluirla.
describe("la galeria de desarrollo no entra en el build de produccion", () => {
  it(
    "ni como pagina, ni como codigo, ni como estilos",
    async () => {
      const result = await build({ logLevel: "silent", build: { write: false } });
      const outputs = (Array.isArray(result) ? result : [result]).flatMap((r) =>
        "output" in r ? r.output : [],
      );

      // La prueba no es vacia: hay build real y la galeria existe en el codigo fuente.
      expect(outputs.some((o) => o.fileName === "index.html")).toBe(true);
      expect(gallerySource).toContain(GALLERY_MARKER);

      expect(outputs.map((o) => o.fileName).filter((n) => /gallery/i.test(n))).toEqual([]);
      for (const output of outputs) {
        const content = output.type === "chunk" ? output.code : String(output.source);
        expect(content, output.fileName).not.toContain(GALLERY_MARKER);
        expect(content, output.fileName).not.toContain("gallery-panel");
        expect(content, output.fileName).not.toContain("data-forced-state=\"pressed\"");
      }
    },
    60_000,
  );
});
