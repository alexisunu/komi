// Archivos de Cloudflare Pages en public/ (SRS 19.23): se copian tal cual a dist/.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (name: string) => readFileSync(resolve(__dirname, "../../public", name), "utf-8");

interface Rule {
  path: string;
  headers: Record<string, string>;
}

/** Interpreta `_headers`: una ruta sin sangria y sus cabeceras con sangria. */
function parseHeaders(text: string): Rule[] {
  const rules: Rule[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    if (/^\s/.test(line)) {
      const [name, ...rest] = line.trim().split(":");
      const rule = rules[rules.length - 1];
      if (rule && name) rule.headers[name.trim()] = rest.join(":").trim();
    } else {
      rules.push({ path: line.trim(), headers: {} });
    }
  }
  return rules;
}

const rules = parseHeaders(read("_headers"));
const cacheFor = (path: string) => rules.find((rule) => rule.path === path)?.headers["Cache-Control"];

describe("_headers", () => {
  it("el Service Worker, el shell y el manifest siempre se revalidan", () => {
    for (const path of ["/sw.js", "/index.html", "/", "/manifest.webmanifest"]) {
      expect(cacheFor(path), path).toBe("no-cache");
    }
  });

  it("los archivos con hash se cachean un anio sin revalidar", () => {
    expect(cacheFor("/assets/*")).toBe("public, max-age=31536000, immutable");
  });

  it("fuentes e iconos (sin hash) no son inmutables", () => {
    for (const path of ["/fonts/*", "/icons/*"]) {
      expect(cacheFor(path), path).toBeDefined();
      expect(cacheFor(path), path).not.toContain("immutable");
    }
  });

  it("ninguna regla deja cachear sw.js, el shell ni el manifest", () => {
    for (const rule of rules) {
      const cache = rule.headers["Cache-Control"] ?? "";
      if (["/sw.js", "/index.html", "/", "/manifest.webmanifest"].includes(rule.path)) continue;
      expect(rule.path === "/*" && cache !== "", "la regla general no fija cache").toBe(false);
    }
  });

  it("todas las respuestas llevan nosniff y la politica de referencia", () => {
    const all = rules.find((rule) => rule.path === "/*");
    expect(all?.headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(all?.headers["Referrer-Policy"]).toBe("same-origin");
  });

  it("no hay rutas duplicadas (Pages las sumaria)", () => {
    const paths = rules.map((rule) => rule.path);
    expect(new Set(paths).size).toBe(paths.length);
  });
});

// Cualquier ruta interna abierta directamente (recarga, enlace) debe cargar la app. Cloudflare Pages
// lo hace solo (modo SPA) si no hay 404.html en la raiz; la regla "/*  /index.html  200" la descarta
// por bucle infinito, asi que no debe volver, y nada debe desactivar el modo SPA.
describe("respaldo a index.html (modo SPA de Pages)", () => {
  const rulesOf = (text: string) =>
    text.split(/\r?\n/).filter((line) => line.trim() !== "" && !line.trim().startsWith("#"));

  it("_redirects no tiene reglas (la de /* a /index.html la ignora Pages y no hace falta)", () => {
    expect(rulesOf(read("_redirects"))).toEqual([]);
  });

  it("no hay 404.html en public/: con uno, Pages deja de servir el shell en rutas desconocidas", () => {
    expect(existsSync(resolve(__dirname, "../../public/404.html"))).toBe(false);
  });

  it("index.html existe en la raiz del proyecto: es el shell que Pages sirve en esas rutas", () => {
    expect(existsSync(resolve(__dirname, "../../index.html"))).toBe(true);
  });

  it("sin la regla, sw.js sigue siendo un archivo con su propia cabecera no-cache", () => {
    expect(cacheFor("/sw.js")).toBe("no-cache");
    expect(rulesOf(read("_redirects")).some((line) => line.includes("sw.js"))).toBe(false);
  });
});
