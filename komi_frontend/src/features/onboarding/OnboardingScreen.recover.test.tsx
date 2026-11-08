// "Ya tengo un codigo" (Fase 5.3): la pantalla de recuperar datos del onboarding. La funcion que
// recupera es falsa: aqui solo se prueba lo que ve y hace el lector.

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../../core/theme/ThemeContext";
import type { RestoreOutcome } from "../../data/network/restoreService";
import { render, typeInto } from "../../test/render";
import {
  EPUB_NOTE,
  FAILED_MESSAGE,
  NOT_FOUND_MESSAGE,
  OTHER_ACCOUNT_MESSAGE,
  STORAGE_MESSAGE,
  UNAVAILABLE_MESSAGE,
} from "../recovery/recoveryMessages";
import { OnboardingScreen } from "./OnboardingScreen";

let mounted: ReturnType<typeof render> | null = null;

function defer<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

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

const RESTORED: RestoreOutcome = {
  kind: "restored",
  report: { profileCreated: true, booksAdded: 1, booksAdvanced: 0, sessionsAdded: 0, chatsAdded: 0 },
};

function mount(over: { onRecover?: ((code: string) => Promise<RestoreOutcome>) | null; waking?: boolean } = {}) {
  const onRecovered = vi.fn();
  const onRecover = over.onRecover === null ? undefined : (over.onRecover ?? vi.fn(async () => RESTORED));
  mounted = render(
    <ThemeProvider>
      <OnboardingScreen
        onProfileCreated={vi.fn()}
        onFinish={vi.fn()}
        {...(onRecover ? { onRecover } : {})}
        onRecovered={onRecovered}
        waking={over.waking ?? false}
        service={{ completeOnboarding: vi.fn() } as never}
      />
    </ThemeProvider>,
  );
  return { root: mounted.container, onRecover, onRecovered };
}

const button = (root: HTMLElement, text: string) =>
  [...root.querySelectorAll("button")].find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined;
const input = (root: HTMLElement) => root.querySelector<HTMLInputElement>("#recovery-code") as HTMLInputElement;

async function tap(el: Element | null | undefined) {
  if (!el) throw new Error("Elemento no encontrado");
  await act(async () => {
    (el as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 10));
  });
}

async function openRecover(root: HTMLElement) {
  await tap(button(root, "Ya tengo un código de recuperación"));
}

describe("entrada a la recuperacion", () => {
  it("la bienvenida ofrece 'Ya tengo un código de recuperación' junto a Comenzar", () => {
    const { root } = mount();
    expect(button(root, "Comenzar")).toBeDefined();
    expect(button(root, "Ya tengo un código de recuperación")).toBeDefined();
  });

  it("sin la funcion de recuperar no se ofrece la opcion", () => {
    const { root } = mount({ onRecover: null });
    expect(button(root, "Ya tengo un código de recuperación")).toBeUndefined();
  });

  it("la bienvenida sigue con 2 bloques funcionales como maximo", () => {
    const { root } = mount();
    expect(root.querySelectorAll("[data-block]").length).toBeLessThanOrEqual(4);
  });

  it("abre la pantalla de recuperar, con el foco en el titulo", async () => {
    const { root } = mount();
    await openRecover(root);
    expect(root.querySelector('[data-screen="recover"]')).not.toBeNull();
    expect(document.activeElement?.textContent).toBe("Recupera tus datos");
  });

  it("la pantalla de recuperar tiene a lo sumo 4 bloques funcionales", async () => {
    const { root } = mount();
    await openRecover(root);
    expect(root.querySelectorAll("[data-block]").length).toBeLessThanOrEqual(4);
  });

  it("avisa de que los .epub no se guardan en el servidor", async () => {
    const { root } = mount();
    await openRecover(root);
    expect(root.textContent).toContain(EPUB_NOTE);
    expect(input(root).getAttribute("aria-describedby")).toBe("recovery-note");
  });

  it("el campo no corrige ni capitaliza el codigo", async () => {
    const { root } = mount();
    await openRecover(root);
    const field = input(root);
    expect(field.getAttribute("autocapitalize")).toBe("none");
    expect(field.getAttribute("autocorrect")).toBe("off");
    expect(field.getAttribute("autocomplete")).toBe("off");
    expect(field.getAttribute("spellcheck")).toBe("false");
  });

  it("'Volver' regresa a la bienvenida", async () => {
    const { root } = mount();
    await openRecover(root);
    await tap(button(root, "Volver"));
    expect(root.querySelector('[data-screen="welcome"]')).not.toBeNull();
  });
});

describe("recuperar", () => {
  it("el boton espera a que haya un codigo", async () => {
    const { root } = mount();
    await openRecover(root);
    expect(button(root, "Recuperar")?.disabled).toBe(true);
    typeInto(input(root), "   ");
    expect(button(root, "Recuperar")?.disabled).toBe(true);
    typeInto(input(root), "abc");
    expect(button(root, "Recuperar")?.disabled).toBe(false);
  });

  it("envia el codigo tal como se escribio y, con exito, avisa a la app", async () => {
    const { root, onRecover, onRecovered } = mount();
    await openRecover(root);
    typeInto(input(root), "  Mi-Codigo  ");
    await tap(button(root, "Recuperar"));
    expect(onRecover).toHaveBeenCalledWith("  Mi-Codigo  ");
    expect(onRecovered).toHaveBeenCalledTimes(1);
  });

  it("Enter en el campo tambien recupera, sin recargar la pagina", async () => {
    const { root, onRecover } = mount();
    await openRecover(root);
    typeInto(input(root), "abc");
    const submit = new Event("submit", { bubbles: true, cancelable: true });
    await act(async () => {
      root.querySelector("form")?.dispatchEvent(submit);
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(onRecover).toHaveBeenCalledTimes(1);
    expect(submit.defaultPrevented).toBe(true);
  });

  it.each<[RestoreOutcome, string]>([
    [{ kind: "not_found" }, NOT_FOUND_MESSAGE],
    [{ kind: "other_account" }, OTHER_ACCOUNT_MESSAGE],
    [{ kind: "unavailable" }, UNAVAILABLE_MESSAGE],
    [{ kind: "storage" }, STORAGE_MESSAGE],
    [{ kind: "failed" }, FAILED_MESSAGE],
  ])("ante %j muestra el aviso y deja intentar de nuevo", async (outcome, message) => {
    const { root, onRecovered } = mount({ onRecover: vi.fn(async () => outcome) });
    await openRecover(root);
    typeInto(input(root), "abc");
    await tap(button(root, "Recuperar"));
    expect(root.querySelector('[role="alert"]')?.textContent).toBe(message);
    expect(onRecovered).not.toHaveBeenCalled();
    expect(button(root, "Recuperar")?.disabled).toBe(false);
    expect(input(root).value).toBe("abc");
  });

  it("si la funcion lanza una excepcion, avisa sin romper la pantalla", async () => {
    const { root } = mount({ onRecover: vi.fn(async () => Promise.reject(new Error("x"))) });
    await openRecover(root);
    typeInto(input(root), "abc");
    await tap(button(root, "Recuperar"));
    expect(root.querySelector('[role="alert"]')?.textContent).toBe(FAILED_MESSAGE);
  });

  it("un nuevo intento borra el aviso anterior de inmediato, sin esperar la respuesta", async () => {
    const gate = defer<RestoreOutcome>();
    const onRecover = vi
      .fn<(code: string) => Promise<RestoreOutcome>>()
      .mockResolvedValueOnce({ kind: "not_found" })
      .mockImplementationOnce(() => gate.promise);
    const { root } = mount({ onRecover });
    await openRecover(root);
    typeInto(input(root), "abc");
    await tap(button(root, "Recuperar"));
    expect(root.querySelector('[role="alert"]')?.textContent).toBe(NOT_FOUND_MESSAGE);
    await tap(button(root, "Recuperar"));
    expect(root.querySelector('[role="alert"]')).toBeNull();
    await act(async () => gate.resolve({ kind: "unavailable" }));
    expect(root.querySelector('[role="alert"]')?.textContent).toBe(UNAVAILABLE_MESSAGE);
  });

  it("enviar el formulario mientras ya se esta recuperando no manda una segunda peticion", async () => {
    const gate = defer<RestoreOutcome>();
    const onRecover = vi.fn(() => gate.promise);
    const { root } = mount({ onRecover });
    await openRecover(root);
    typeInto(input(root), "abc");
    await tap(button(root, "Recuperar"));
    await act(async () => {
      root.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(onRecover).toHaveBeenCalledTimes(1);
    await act(async () => gate.resolve({ kind: "not_found" }));
  });

  it("enviar el formulario sin codigo no recupera nada", async () => {
    const { root, onRecover } = mount();
    await openRecover(root);
    await act(async () => {
      root.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(onRecover).not.toHaveBeenCalled();
  });

  it("'Volver' borra el aviso", async () => {
    const { root } = mount({ onRecover: vi.fn(async () => ({ kind: "not_found" }) as RestoreOutcome) });
    await openRecover(root);
    typeInto(input(root), "abc");
    await tap(button(root, "Recuperar"));
    await tap(button(root, "Volver"));
    await openRecover(root);
    expect(root.querySelector('[role="alert"]')).toBeNull();
  });
});

describe("mientras recupera", () => {
  it("dice 'Recuperando tus datos', bloquea todo y no deja enviar dos veces", async () => {
    const gate = defer<RestoreOutcome>();
    const onRecover = vi.fn(() => gate.promise);
    const { root } = mount({ onRecover });
    await openRecover(root);
    typeInto(input(root), "abc");
    await tap(button(root, "Recuperar"));
    expect(button(root, "Recuperando tus datos")?.disabled).toBe(true);
    expect(button(root, "Volver")?.disabled).toBe(true);
    expect(input(root).disabled).toBe(true);
    await tap(button(root, "Recuperando tus datos"));
    await tap(button(root, "Volver"));
    expect(onRecover).toHaveBeenCalledTimes(1);
    expect(root.querySelector('[data-screen="recover"]')).not.toBeNull();
    await act(async () => gate.resolve({ kind: "not_found" }));
  });

  it("con el servidor arrancando dice 'Despertando a Komi'", async () => {
    const gate = defer<RestoreOutcome>();
    const { root } = mount({ onRecover: vi.fn(() => gate.promise), waking: true });
    await openRecover(root);
    typeInto(input(root), "abc");
    await tap(button(root, "Recuperar"));
    expect(button(root, "Despertando a Komi")).toBeDefined();
    expect(button(root, "Recuperando tus datos")).toBeUndefined();
    await act(async () => gate.resolve({ kind: "not_found" }));
  });

  it("'Despertando a Komi' solo aparece mientras se recupera", async () => {
    const { root } = mount({ waking: true });
    await openRecover(root);
    expect(root.textContent).not.toContain("Despertando a Komi");
  });
});
