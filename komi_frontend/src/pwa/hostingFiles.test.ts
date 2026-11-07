// Archivos de Cloudflare Pages en public/ (SRS 19.23): se copian tal cual a dist/.
import { readFileSync } from "node:fs";
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

describe("_redirects", () => {
  it("cualquier ruta devuelve index.html con 200 (reescritura, no redireccion)", () => {
    const lines = read("_redirects")
      .split(/\r?\n/)
      .filter((line) => line.trim() !== "" && !line.trim().startsWith("#"));
    expect(lines.map((line) => line.trim().split(/\s+/))).toEqual([["/*", "/index.html", "200"]]);
  });
});
