// Ajustes (Fase 5.3): codigo de recuperacion y "volver a traer mis datos". Lo que recupera es falso.

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../../core/theme/ThemeContext";
import type { RestoreOutcome } from "../../data/network/restoreService";
import { render } from "../../test/render";
import { FAILED_MESSAGE, NOT_FOUND_MESSAGE, UNAVAILABLE_MESSAGE } from "../recovery/recoveryMessages";
import { RECOVERY_WARNING, SettingsPanel, type SettingsRecovery } from "./SettingsPanel";

const CODE = "00000000-0000-4000-8000-000000000900";
let mounted: ReturnType<typeof render> | null = null;

beforeEach(() => {
  document.documentElement.removeAttribute("data-theme");
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }) as never,
  );
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.unstubAllGlobals();
});

function defer<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const OK: RestoreOutcome = {
  kind: "restored",
  report: { profileCreated: false, booksAdded: 2, booksAdvanced: 0, sessionsAdded: 1, chatsAdded: 0 },
};

function mount(over: { recovery?: SettingsRecovery | null; copyText?: (text: string) => Promise<void> } = {}) {
  const recovery =
    over.recovery === null ? undefined : (over.recovery ?? { code: CODE, onRestore: vi.fn(async () => OK) });
  mounted = render(
    <ThemeProvider>
      <SettingsPanel
        onClose={vi.fn()}
        recovery={recovery}
        {...(over.copyText ? { copyText: over.copyText } : {})}
      />
    </ThemeProvider>,
  );
  return { root: mounted.container, recovery };
}

const button = (root: HTMLElement, text: string) =>
  [...root.querySelectorAll("button")].find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined;

async function tap(el: Element | null | undefined) {
  if (!el) throw new Error("Elemento no encontrado");
  await act(async () => {
    (el as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 10));
  });
}

describe("codigo de recuperacion", () => {
  it("muestra el codigo del dispositivo y el aviso de que da acceso a los datos", () => {
    const { root } = mount();
    expect(root.querySelector('[data-testid="recovery-code"]')?.textContent).toBe(CODE);
    expect(root.textContent).toContain("Código de recuperación");
    expect(root.textContent).toContain(RECOVERY_WARNING);
    expect(RECOVERY_WARNING).toBe("Quien tenga este código puede ver tus lecturas y charlas. Guárdalo solo donde confíes.");
  });

  it("sin datos de recuperacion el panel solo trae el interruptor de tema", () => {
    const { root } = mount({ recovery: null });
    expect(root.querySelector('[data-testid="recovery-code"]')).toBeNull();
    expect(root.textContent).not.toContain("Código de recuperación");
    expect(root.querySelector('[role="switch"]')).not.toBeNull();
  });

  it("el codigo se puede seleccionar de un toque (para copiarlo a mano)", () => {
    const { root } = mount();
    expect(root.querySelector('[data-testid="recovery-code"]')?.className).toContain("settings-panel__code");
  });

  it("'Copiar código' pone el codigo en el portapapeles y lo confirma", async () => {
    const copyText = vi.fn(async () => {});
    const { root } = mount({ copyText });
    await tap(button(root, "Copiar código"));
    expect(copyText).toHaveBeenCalledWith(CODE);
    expect(root.querySelector('[role="status"]')?.textContent).toBe("Código copiado.");
  });

  it("si no se puede copiar, dice como hacerlo a mano", async () => {
    const copyText = vi.fn(async () => Promise.reject(new Error("denegado")));
    const { root } = mount({ copyText });
    await tap(button(root, "Copiar código"));
    expect(root.querySelector('[role="status"]')?.textContent).toBe(
      "No pudimos copiarlo. Mantén pulsado el código para copiarlo.",
    );
  });

  it("sin portapapeles en el navegador tambien avisa en vez de romperse", async () => {
    vi.stubGlobal("navigator", { clipboard: undefined });
    const { root } = mount();
    await tap(button(root, "Copiar código"));
    expect(root.querySelector('[role="status"]')?.textContent).toContain("No pudimos copiarlo");
  });
});

describe("volver a traer mis datos", () => {
  it("pide la recuperacion y cuenta lo que se agrego", async () => {
    const { root, recovery } = mount();
    await tap(button(root, "Volver a traer mis datos"));
    expect(recovery?.onRestore).toHaveBeenCalledTimes(1);
    expect(root.querySelector('[role="status"]')?.textContent).toBe("Recuperamos 2 libros y 1 sesión.");
  });

  it("si ya estaba todo, dice que esta al dia", async () => {
    const onRestore = vi.fn(async (): Promise<RestoreOutcome> => ({
      kind: "restored",
      report: { profileCreated: false, booksAdded: 0, booksAdvanced: 0, sessionsAdded: 0, chatsAdded: 0 },
    }));
    const { root } = mount({ recovery: { code: CODE, onRestore } });
    await tap(button(root, "Volver a traer mis datos"));
    expect(root.querySelector('[role="status"]')?.textContent).toBe("Tus datos ya están al día en este dispositivo.");
  });

  it.each<[RestoreOutcome, string]>([
    [{ kind: "not_found" }, NOT_FOUND_MESSAGE],
    [{ kind: "unavailable" }, UNAVAILABLE_MESSAGE],
    [{ kind: "failed" }, FAILED_MESSAGE],
  ])("ante %j muestra un aviso (alerta)", async (outcome, message) => {
    const { root } = mount({ recovery: { code: CODE, onRestore: vi.fn(async () => outcome) } });
    await tap(button(root, "Volver a traer mis datos"));
    expect(root.querySelector('[role="alert"]')?.textContent).toBe(message);
  });

  it("si lanza una excepcion, avisa sin romper el panel", async () => {
    const { root } = mount({ recovery: { code: CODE, onRestore: vi.fn(async () => Promise.reject(new Error("x"))) } });
    await tap(button(root, "Volver a traer mis datos"));
    expect(root.querySelector('[role="alert"]')?.textContent).toBe(FAILED_MESSAGE);
  });

  it("mientras trae datos el boton se bloquea y no se pide dos veces", async () => {
    const gate = defer<RestoreOutcome>();
    const onRestore = vi.fn(() => gate.promise);
    const { root } = mount({ recovery: { code: CODE, onRestore } });
    await tap(button(root, "Volver a traer mis datos"));
    const busy = button(root, "Trayendo tus datos");
    expect(busy?.disabled).toBe(true);
    await tap(busy);
    expect(onRestore).toHaveBeenCalledTimes(1);
    await act(async () => gate.resolve(OK));
    expect(button(root, "Volver a traer mis datos")?.disabled).toBe(false);
  });

  it("un nuevo intento borra el aviso anterior de inmediato, sin esperar la respuesta", async () => {
    const gate = defer<RestoreOutcome>();
    const onRestore = vi
      .fn<() => Promise<RestoreOutcome>>()
      .mockResolvedValueOnce({ kind: "unavailable" })
      .mockImplementationOnce(() => gate.promise);
    const { root } = mount({ recovery: { code: CODE, onRestore } });
    await tap(button(root, "Volver a traer mis datos"));
    expect(root.querySelector('[role="alert"]')).not.toBeNull();
    await tap(button(root, "Volver a traer mis datos"));
    expect(root.querySelector('[role="alert"]')).toBeNull();
    expect(root.querySelector('[role="status"]')).toBeNull();
    await act(async () => gate.resolve(OK));
    expect(root.querySelector('[role="status"]')).not.toBeNull();
  });
});
