import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildThemeCss } from "./themeCss";

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return cssFiles(path);
    return path.endsWith(".css") ? [path] : [];
  });
}

describe("variables CSS", () => {
  it("toda var(--x) usada en src existe en el tema, o se define en el mismo archivo", () => {
    const defined = new Set([...buildThemeCss().matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1] as string));
    const missing: string[] = [];
    for (const file of cssFiles("src")) {
      const css = readFileSync(file, "utf-8");
      const local = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1] as string));
      for (const m of css.matchAll(/var\((--[a-z0-9-]+)/g)) {
        const name = m[1] as string;
        if (!defined.has(name) && !local.has(name)) missing.push(`${file}: ${name}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
