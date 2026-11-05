// Script de UN SOLO USO: genera los iconos de la PWA a partir del girasol en flor (etapa
// BLOOM_4 de SunflowerStageWidget). No es parte del build ni de package.json: se corre a mano
// cuando cambie el dibujo o los tokens, y los PNG resultantes se versionan.
//
//   node scripts/generate-icons.mjs
//
// Usa Microsoft Edge o Chrome en modo headless para rasterizar (no agrega dependencias). Los
// colores se leen del tema claro de src/core/theme/colorTokens.ts; aqui no hay hex propios.
// Si Edge no esta en la ruta por defecto, define EDGE_PATH.
//
// Salida (public/icons/):
//   apple-touch-icon-180.png  180x180, fondo bg-primary opaco, sin transparencia.
//   icon-192.png              192x192, purpose "any", fondo bg-primary opaco.
//   icon-512.png              512x512, purpose "any", fondo bg-primary opaco.
//   icon-maskable-512.png     512x512, purpose "maskable": fondo a sangre y el girasol dentro de
//                             la zona segura (circulo central del 80 %).

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public", "icons");

// --- Colores: bloque KOMOREBI de colorTokens.ts -------------------------------------------------
const tokensSource = readFileSync(join(root, "src", "core", "theme", "colorTokens.ts"), "utf8");
const lightBlock = tokensSource.slice(
  tokensSource.indexOf("export const KOMOREBI"),
  tokensSource.indexOf("export const TSUKIMI"),
);
const tokens = Object.fromEntries(
  [...lightBlock.matchAll(/"([a-z-]+)":\s*"(#[0-9A-Fa-f]{6})"/g)].map((m) => [m[1], m[2]]),
);
function token(name) {
  const value = tokens[name];
  if (!value) throw new Error(`Falta el token ${name} en KOMOREBI`);
  return value;
}

// --- Dibujo: la flor de SunflowerStageWidget (lienzo de 220) --------------------------------------
const PETAL = "M 110 42 C 118 42, 121 58, 110 70 C 99 58, 102 42, 110 42 Z";
// Centro del dibujo (caja de 64 a 156 en x, de 42 a 182 en y) y radio maximo desde ese centro.
const CENTER = { x: 110, y: 112 };
const DRAWING_RADIUS = 85;

function flower() {
  const line = `stroke="${token("text-primary")}" stroke-width="1.75" stroke-linejoin="round"`;
  const petals = Array.from({ length: 12 }, (_, i) => {
    const fill = i % 2 === 0 ? token("accent-primary") : token("petal-inner");
    return `<path d="${PETAL}" fill="${fill}" ${line} transform="rotate(${30 * i} 110 78)"/>`;
  }).join("");
  const leaf = (d) => `<path d="${d}" fill="${token("accent-secondary")}" ${line}/>`;
  const dot = (cx, cy) => `<circle cx="${cx}" cy="${cy}" r="1.3" fill="${token("bg-surface")}"/>`;
  return [
    `<path d="M 110 176 Q 107 128 110 82" fill="none" stroke="${token("accent-secondary")}" stroke-width="4.2" stroke-linecap="round"/>`,
    leaf("M 109 154 C 74 148, 68 124, 92 124 C 102 124, 108 142, 109 154 Z"),
    leaf("M 110 142 C 144 136, 150 112, 126 112 C 116 112, 111 130, 110 142 Z"),
    petals,
    `<circle cx="110" cy="78" r="17" fill="${token("text-on-accent")}" ${line}/>`,
    `<circle cx="110" cy="78" r="12" fill="none" stroke="${token("text-secondary")}" stroke-width="1.25" stroke-dasharray="2 3"/>`,
    dot(106, 74), dot(114, 74), dot(110, 78), dot(105, 82), dot(115, 82),
    `<path d="M 72 182 Q 110 166 148 182 Z" fill="${token("bg-surface")}" ${line}/>`,
    `<path d="M 64 182 L 156 182" fill="none" stroke="${token("text-primary")}" stroke-width="1.75" stroke-linecap="round"/>`,
  ].join("");
}

// Espacio de trabajo de 512: el dibujo se centra y se escala por `scale`.
const SAFE_RADIUS = 512 * 0.4; // zona segura de un icono maskable: circulo del 80 % central
const ICONS = [
  { file: "apple-touch-icon-180.png", size: 180, scale: 2.5 },
  { file: "icon-192.png", size: 192, scale: 2.5 },
  { file: "icon-512.png", size: 512, scale: 2.5 },
  { file: "icon-maskable-512.png", size: 512, scale: 2.3, maskable: true },
];

function svgFor({ size, scale }) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">` +
    `<rect width="512" height="512" fill="${token("bg-primary")}"/>` +
    `<g transform="translate(256 256) scale(${scale}) translate(${-CENTER.x} ${-CENTER.y})">${flower()}</g>` +
    `</svg>`
  );
}

// --- Rasterizado con Edge / Chrome headless -------------------------------------------------------
function findBrowser() {
  const candidates = [
    process.env.EDGE_PATH,
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
  ].filter(Boolean);
  const found = candidates.find((path) => existsSync(path));
  if (!found) throw new Error("No encontre Edge ni Chrome. Define EDGE_PATH con la ruta del ejecutable.");
  return found;
}

function pngSize(path) {
  const buffer = readFileSync(path);
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

mkdirSync(outDir, { recursive: true });
const browser = findBrowser();
const work = mkdtempSync(join(tmpdir(), "komi-icons-"));
try {
  for (const icon of ICONS) {
    if (icon.maskable && DRAWING_RADIUS * icon.scale > SAFE_RADIUS) {
      throw new Error("El girasol maskable se sale de la zona segura.");
    }
    const html = join(work, "icon.html");
    writeFileSync(
      html,
      `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;padding:0;overflow:hidden}svg{display:block}</style>${svgFor(icon)}`,
    );
    const target = join(outDir, icon.file);
    execFileSync(
      browser,
      [
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--force-device-scale-factor=1",
        `--user-data-dir=${join(work, "profile")}`,
        `--window-size=${icon.size},${icon.size}`,
        `--screenshot=${target}`,
        pathToFileURL(html).href,
      ],
      { stdio: "ignore" },
    );
    const { width, height } = pngSize(target);
    if (width !== icon.size || height !== icon.size) {
      throw new Error(`${icon.file} salio de ${width}x${height}; se esperaba ${icon.size}x${icon.size}.`);
    }
    console.log(`${icon.file}  ${width}x${height}`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
