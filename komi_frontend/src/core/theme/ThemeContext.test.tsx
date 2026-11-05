import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { THEMES } from "./colorTokens";
import { ThemeProvider, useTheme } from "./ThemeContext";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mockSystemDark(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  );
}

function Probe() {
  const { theme, toggleTheme } = useTheme();
  return (
    <button type="button" onClick={toggleTheme}>
      {theme}
    </button>
  );
}

describe("ThemeProvider", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    document.documentElement.removeAttribute("data-theme");
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("fija data-theme segun el sistema cuando no hay eleccion", () => {
    mockSystemDark(true);
    act(() =>
      root.render(
        <ThemeProvider>
          <Probe />
        </ThemeProvider>,
      ),
    );
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("el onboarding precondiciona Tsukimi aunque el sistema sea claro", () => {
    mockSystemDark(false);
    act(() =>
      root.render(
        <ThemeProvider preconfigureTsukimi={true}>
          <Probe />
        </ThemeProvider>,
      ),
    );
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("el interruptor cambia el tema y avisa para persistirlo", () => {
    mockSystemDark(false);
    const onModeChange = vi.fn();
    act(() =>
      root.render(
        <ThemeProvider onModeChange={onModeChange}>
          <Probe />
        </ThemeProvider>,
      ),
    );
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    act(() => container.querySelector("button")?.click());
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(onModeChange).toHaveBeenCalledWith("dark");
  });

  it("el theme-color sigue al tema activo, tambien si el lector contradice al sistema", () => {
    mockSystemDark(false);
    const meta = document.createElement("meta");
    meta.setAttribute("name", "theme-color");
    meta.setAttribute("content", "x");
    document.head.appendChild(meta);
    act(() =>
      root.render(
        <ThemeProvider>
          <Probe />
        </ThemeProvider>,
      ),
    );
    expect(meta.getAttribute("content")).toBe(THEMES.light.brand["bg-primary"]);
    act(() => container.querySelector("button")?.click());
    expect(meta.getAttribute("content")).toBe(THEMES.dark.brand["bg-primary"]);
    meta.remove();
  });
});
