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
