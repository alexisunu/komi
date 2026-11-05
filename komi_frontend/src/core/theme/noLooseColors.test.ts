import { describe, expect, it } from "vitest";

// CLAUDE.md 5: nunca hex sueltos fuera de core/theme/colorTokens.ts.
const sources = import.meta.glob("/src/**/*.{ts,tsx,css}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const HEX = /#[0-9a-fA-F]{3,8}\b/g;
const ALLOWED = new Set(["/src/core/theme/colorTokens.ts"]);

describe("colores sueltos", () => {
  it("hay archivos que revisar", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(3);
  });

  it("ningun archivo de src fuera de colorTokens.ts contiene hex", () => {
    const offenders: string[] = [];
    for (const [path, content] of Object.entries(sources)) {
      if (ALLOWED.has(path) || /\.test\.tsx?$/.test(path)) continue;
      const matches = content.match(HEX);
      if (matches) offenders.push(`${path}: ${matches.join(", ")}`);
    }
    expect(offenders).toEqual([]);
  });
});
