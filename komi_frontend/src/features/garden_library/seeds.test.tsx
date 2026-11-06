import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../../core/theme/ThemeContext";
import type { LocalBook } from "../../data/local_db/types";
import type { Seed } from "../../services/seedService";
import { render } from "../../test/render";
import { BookGardenCard } from "./BookGardenCard";
import { MyGardenScreen } from "./MyGardenScreen";
import { SeedsDrawer } from "./SeedsDrawer";

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

function book(over: Partial<LocalBook> = {}): LocalBook {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    title: "Kokoro",
    author: "Natsume Soseki",
    format_type: "PHYSICAL",
    sunflower_variant: "CLASSIC",
    status: "ACTIVE",
    total_pages: 264,
    current_page: 87,
    progress_percentage: 32.95,
    last_epub_cfi: null,
    created_at: "2026-11-01T00:00:00.000Z",
    completed_at: null,
    updated_at: "2026-11-01T00:00:00.000Z",
    pending_sync: 0,
    ...over,
  };
}

function seed(n: number, text: string, date = "5 de noviembre de 2026"): Seed {
  return { chatId: `c${n}`, bookId: book().id, text, startedAtLocal: "2026-11-05T23:50:00", dateLabel: date };
}

function mount(element: React.ReactElement) {
  mounted = render(<ThemeProvider>{element}</ThemeProvider>);
  return mounted.container;
}

async function tap(el: Element | null | undefined) {
  if (!el) throw new Error("Elemento no encontrado");
  await act(async () => {
    (el as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 0));
  });
}

const noop = async () => {};
const source = (seeds: Seed[]) => ({ loadByBook: async () => new Map([[book().id, seeds]]) });

function garden(books: LocalBook[], seeds: Seed[]) {
  return (
    <MyGardenScreen
      books={books}
      missingFiles={new Set()}
      activeBookId={null}
      plant={{} as never}
      onPlanted={() => {}}
      onSetStatus={noop}
      onReimport={noop}
      onRead={noop}
      seedSource={source(seeds)}
    />
  );
}

const flush = () => act(async () => new Promise((r) => setTimeout(r, 20)));

describe("zona tactil del girasol", () => {
  it("es un boton con etiqueta accesible y el contador", () => {
    const root = mount(<BookGardenCard book={book()} seeds={[seed(1, "a"), seed(2, "b")]} onOpenSeeds={() => {}} />);
    const button = root.querySelector(".book-card__seeds") as HTMLButtonElement;
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("aria-label")).toBe("Semillas del Día de Kokoro: 2 semillas");
    expect(button.textContent).toContain("2 semillas");
  });

  it("con una semilla usa el singular; sin semillas no muestra contador pero sigue abriendo", () => {
    const one = mount(<BookGardenCard book={book()} seeds={[seed(1, "a")]} onOpenSeeds={() => {}} />);
    expect(one.querySelector(".book-card__seeds")?.getAttribute("aria-label")).toBe("Semillas del Día de Kokoro: 1 semilla");
    mounted?.unmount();
    const none = mount(<BookGardenCard book={book()} onOpenSeeds={() => {}} />);
    expect(none.querySelector(".book-card__seeds-count")).toBeNull();
    expect(none.querySelector(".book-card__seeds")?.getAttribute("aria-label")).toBe("Semillas del Día de Kokoro: 0 semillas");
  });

  it("tocar el girasol avisa con el libro", async () => {
    const onOpen = vi.fn();
    const root = mount(<BookGardenCard book={book()} onOpenSeeds={onOpen} />);
    await tap(root.querySelector(".book-card__seeds"));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ title: "Kokoro" }));
  });

  it("sin manejador el girasol no es un boton", () => {
    const root = mount(<BookGardenCard book={book()} />);
    expect(root.querySelector(".book-card__seeds")).toBeNull();
  });
});

describe("cajon de Semillas del Dia", () => {
  it("lista la frase y la fecha larga de cada semilla", () => {
    mount(
      <SeedsDrawer
        book={book()}
        seeds={[seed(1, "Leer es sembrar.", "5 de noviembre de 2026"), seed(2, "Despacio.", "3 de noviembre de 2026")]}
        onClose={() => {}}
      />,
    );
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.textContent).toContain("Semillas del Día");
    expect(dialog.textContent).toContain("Kokoro");
    const items = [...dialog.querySelectorAll("li")].map((li) => li.textContent);
    expect(items).toEqual(["Leer es sembrar.5 de noviembre de 2026", "Despacio.3 de noviembre de 2026"]);
  });

  it("sin semillas muestra un texto amable", () => {
    mount(<SeedsDrawer book={book()} seeds={[]} onClose={() => {}} />);
    expect(document.querySelector(".seeds__empty")?.textContent).toContain("Aún no hay semillas");
    expect(document.querySelector("li")).toBeNull();
  });
});

describe("Mi Jardin con semillas", () => {
  it("tocar el girasol abre el cajon con las semillas del libro y se cierra", async () => {
    const root = mount(garden([book()], [seed(1, "Leer es sembrar.")]));
    await flush();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await tap(root.querySelector(".book-card__seeds"));
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Leer es sembrar.");
    await tap(document.querySelector('[aria-label="Cerrar"]'));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("tambien funciona en libros en barbecho y florecidos", async () => {
    for (const [status, tabLabel] of [
      ["FALLOW", "En barbecho"],
      ["BLOOMED", "Florecidos"],
    ] as const) {
      const progress = status === "BLOOMED" ? 100 : 40;
      const root = mount(garden([book({ status, progress_percentage: progress })], [seed(1, "Frase " + status)]));
      await flush();
      const tab = [...root.querySelectorAll('[role="tab"]')].find((t) => t.textContent?.startsWith(tabLabel));
      await tap(tab);
      await tap(root.querySelector(".book-card__seeds"));
      expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Frase " + status);
      mounted?.unmount();
      mounted = null;
    }
  });

  it("sin servicio de semillas el cajon abre vacio", async () => {
    const root = mount(
      <MyGardenScreen
        books={[book()]}
        missingFiles={new Set()}
        activeBookId={null}
        plant={{} as never}
        onPlanted={() => {}}
        onSetStatus={noop}
        onReimport={noop}
        onRead={noop}
      />,
    );
    await tap(root.querySelector(".book-card__seeds"));
    expect(document.querySelector(".seeds__empty")).not.toBeNull();
  });

  it("las semillas de otro libro no aparecen", async () => {
    const other = book({ id: "00000000-0000-4000-8000-000000000002", title: "Otro" });
    const root = mount(garden([other], [seed(1, "No es de este libro")]));
    await flush();
    await tap(root.querySelector(".book-card__seeds"));
    expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain("No es de este libro");
  });
});
