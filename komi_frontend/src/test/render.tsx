import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Monta un elemento en el DOM de jsdom sin librerias externas. Llamar `unmount` al terminar. */
export function render(element: ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(element));
  return {
    container,
    rerender(next: ReactElement) {
      act(() => root.render(next));
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

export function click(element: Element | null | undefined) {
  if (!element) throw new Error("Elemento no encontrado para hacer clic");
  act(() => {
    (element as HTMLElement).click();
  });
}

/** Escribe en un campo controlado de React (dispara `input` como lo haria el navegador). */
export function typeInto(element: Element | null | undefined, value: string) {
  if (!element) throw new Error("Campo no encontrado");
  const input = element as HTMLInputElement;
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Elige un archivo en un `<input type="file">` y dispara `change`. */
export async function chooseFile(input: Element | null | undefined, file: File) {
  if (!input) throw new Error("Selector de archivos no encontrado");
  await act(async () => {
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
