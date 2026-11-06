import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../../core/theme/ThemeContext";
import { StorageQuotaError } from "../../data/local_db/errors";
import type { LocalBook } from "../../data/local_db/types";
import { EpubImportError } from "../../services/epubService";
import type { PlantBookService } from "../../services/plantBookService";
import { chooseFile, click, render, typeInto } from "../../test/render";
import { BookGardenCard } from "./BookGardenCard";
import { MyGardenScreen } from "./MyGardenScreen";
import { PlantBookModal } from "./PlantBookModal";

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

const byText = (root: ParentNode, selector: string, text: string) =>
  [...root.querySelectorAll(selector)].find((el) => el.textContent?.trim().startsWith(text)) ?? null;
const byLabel = (root: ParentNode, label: string) => root.querySelector(`[aria-label="${label}"]`);

describe("BookGardenCard", () => {
  it("muestra titulo, autor, formato y porcentaje truncado", () => {
    const root = mount(<BookGardenCard book={book()} />);
    expect(root.querySelector("h3")?.textContent).toBe("Kokoro");
    expect(root.textContent).toContain("Natsume Soseki");
    expect(root.textContent).toContain("FÍSICO");
    expect(root.textContent).toContain("32%"); // 32,95 se trunca, no se redondea
  });

  it("el badge de un EPUB dice EPUB", () => {
    const root = mount(<BookGardenCard book={book({ format_type: "EPUB", total_pages: null })} />);
    expect(root.textContent).toContain("EPUB");
  });

  it("un libro activo ofrece barbecho; uno en barbecho, volver a sembrar; uno florecido, ninguno", async () => {
    const onArchive = vi.fn();
    const onRestore = vi.fn();
    const active = mount(<BookGardenCard book={book()} onArchive={onArchive} onRestore={onRestore} />);
    expect(byLabel(active, "Volver a sembrar Kokoro")).toBeNull();
    await tap(byLabel(active, "Poner en barbecho Kokoro"));
    expect(onArchive).toHaveBeenCalledTimes(1);
    mounted?.unmount();

    const fallow = mount(<BookGardenCard book={book({ status: "FALLOW" })} onArchive={onArchive} onRestore={onRestore} />);
    expect(byLabel(fallow, "Poner en barbecho Kokoro")).toBeNull();
    await tap(byLabel(fallow, "Volver a sembrar Kokoro"));
    expect(onRestore).toHaveBeenCalledTimes(1);
    mounted?.unmount();

    const bloomed = mount(
      <BookGardenCard
        book={book({ status: "BLOOMED", progress_percentage: 100 })}
        onArchive={onArchive}
        onRestore={onRestore}
      />,
    );
    expect(bloomed.querySelectorAll(".book-card__action")).toHaveLength(0);
  });

  it("el borde de acento marca el libro del Dashboard", () => {
    const on = mount(<BookGardenCard book={book()} active />);
    expect(on.querySelector(".book-card")?.getAttribute("data-active")).toBe("true");
  });

  it("un EPUB sin archivo avisa con el porcentaje y deja reimportar", async () => {
    const onReimport = vi.fn();
    const root = mount(
      <BookGardenCard
        book={book({ format_type: "EPUB", total_pages: null, progress_percentage: 41.2 })}
        missingFile
        onReimport={onReimport}
      />,
    );
    expect(root.querySelector('[role="status"]')?.textContent).toContain(
      "Reimportar archivo .epub para continuar en el 41%",
    );
    const file = new File(["x"], "kokoro.epub");
    await chooseFile(root.querySelector('input[type="file"]'), file);
    expect(onReimport).toHaveBeenCalledWith(expect.objectContaining({ title: "Kokoro" }), file);
  });

  it("sin el aviso cuando el archivo esta", () => {
    const root = mount(<BookGardenCard book={book({ format_type: "EPUB" })} />);
    expect(root.querySelector('[role="status"]')).toBeNull();
  });
});

function fakePlant(over: Partial<PlantBookService> = {}): PlantBookService {
  return {
    prepareEpub: vi.fn(async () => ({
      data: new ArrayBuffer(8),
      metadata: { title: "Ficciones", author: "Borges" },
    })),
    plantEpub: vi.fn(async (_p, fields) => book({ title: fields.title, author: fields.author, format_type: "EPUB" })),
    plantPhysical: vi.fn(async (input) => book({ title: input.title, author: input.author, total_pages: input.total_pages })),
    reimportEpub: vi.fn(async () => {}),
    ...over,
  };
}

describe("BookGardenCard: Leer este libro", () => {
  const readButton = (root: HTMLElement) =>
    [...root.querySelectorAll("button")].find((b) => b.textContent === "Leer este libro");

  it("aparece en libros activos que no son el del Dashboard y avisa con el libro", () => {
    const onRead = vi.fn();
    const root = mount(<BookGardenCard book={book({ title: "Kokoro" })} onRead={onRead} />);
    click(readButton(root));
    expect(onRead).toHaveBeenCalledWith(expect.objectContaining({ title: "Kokoro" }));
  });

  it("no aparece en el libro que ya es el del Dashboard", () => {
    const root = mount(<BookGardenCard book={book()} active onRead={() => {}} />);
    expect(readButton(root)).toBeUndefined();
  });

  it("no aparece en barbecho ni en libros florecidos (CU-03)", () => {
    const fallow = mount(<BookGardenCard book={book({ status: "FALLOW" })} onRead={() => {}} onRestore={() => {}} />);
    expect(readButton(fallow)).toBeUndefined();
    const bloomed = mount(
      <BookGardenCard book={book({ status: "BLOOMED", progress_percentage: 100 })} onRead={() => {}} />,
    );
    expect(readButton(bloomed)).toBeUndefined();
  });

  it("sin onRead no hay boton", () => {
    expect(readButton(mount(<BookGardenCard book={book()} />))).toBeUndefined();
  });
});

describe("MyGardenScreen", () => {
  function screen(books: LocalBook[], over: Partial<Parameters<typeof MyGardenScreen>[0]> = {}) {
    return mount(
      <MyGardenScreen
        books={books}
        missingFiles={new Set()}
        activeBookId={null}
        plant={fakePlant()}
        onPlanted={() => {}}
        onSetStatus={async () => {}}
        onReimport={async () => {}}
        onRead={async () => {}}
        {...over}
      />,
    );
  }

  it("tiene 3 bloques funcionales (con la navegacion, 4)", () => {
    const root = screen([]);
    expect(root.querySelectorAll("[data-block]")).toHaveLength(3);
    expect(root.querySelector("h1")?.textContent).toBe("Mi Jardín");
  });

  it("vacio: invita a plantar el primer libro", () => {
    const root = screen([]);
    expect(root.textContent).toContain("Todavía no hay semillas plantadas");
  });

  it("las pestañas muestran los libros de cada estado con su cuenta", async () => {
    const root = screen([
      book({ id: "a", title: "Uno" }),
      book({ id: "b", title: "Dos", status: "FALLOW" }),
      book({ id: "c", title: "Tres", status: "BLOOMED", progress_percentage: 100 }),
    ]);
    expect([...root.querySelectorAll("h3")].map((h) => h.textContent)).toEqual(["Uno"]);
    expect(root.querySelector("#garden-tab-fallow")?.textContent).toContain("1");

    await tap(root.querySelector("#garden-tab-fallow"));
    expect([...root.querySelectorAll("h3")].map((h) => h.textContent)).toEqual(["Dos"]);
    expect(root.querySelector("#garden-tab-fallow")?.getAttribute("aria-selected")).toBe("true");

    await tap(root.querySelector("#garden-tab-bloomed"));
    expect([...root.querySelectorAll("h3")].map((h) => h.textContent)).toEqual(["Tres"]);

    await tap(root.querySelector("#garden-tab-active"));
    expect(root.querySelectorAll("h3")).toHaveLength(1);
  });

  it("una pestaña vacia explica que va ahi", async () => {
    const root = screen([book()]);
    await tap(root.querySelector("#garden-tab-bloomed"));
    expect(root.textContent).toContain("Aquí florecerán los libros que termines");
    await tap(root.querySelector("#garden-tab-fallow"));
    expect(root.textContent).toContain("sin perder su avance");
  });

  it("archivar llama a onSetStatus con FALLOW", async () => {
    const onSetStatus = vi.fn(async () => {});
    const root = screen([book()], { onSetStatus });
    await tap(byLabel(root, "Poner en barbecho Kokoro"));
    expect(onSetStatus).toHaveBeenCalledWith(expect.objectContaining({ title: "Kokoro" }), "FALLOW");
  });

  it("si la accion falla, avisa con el mensaje y deja los botones libres otra vez", async () => {
    const onSetStatus = vi.fn(async () => {
      throw new StorageQuotaError();
    });
    const root = screen([book()], { onSetStatus });
    await tap(byLabel(root, "Poner en barbecho Kokoro"));
    expect(root.querySelector('[role="alert"]')?.textContent).toContain("No hay espacio suficiente");
    expect((byLabel(root, "Poner en barbecho Kokoro") as HTMLButtonElement).disabled).toBe(false);
  });

  it("'Plantar libro' abre el modal", async () => {
    const root = screen([]);
    await tap(byText(root, "button", "Plantar libro"));
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it("al plantar cierra el modal, vuelve a Activos y avisa", async () => {
    const onPlanted = vi.fn();
    const root = screen([], { onPlanted });
    await tap(byText(root, "button", "Plantar libro"));
    await tap(byText(document.body, "button", "Libro Físico"));
    typeInto(document.querySelector('input[maxlength="255"]'), "Kokoro");
    const inputs = document.querySelectorAll("input");
    typeInto(inputs[1], "Soseki");
    typeInto(inputs[2], "264");
    await tap(byText(document.body, "button", "Plantar Semilla"));
    expect(onPlanted).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe("PlantBookModal: libro fisico", () => {
  async function openPhysical(plant = fakePlant(), onPlanted = vi.fn(), onClose = vi.fn()) {
    mount(<PlantBookModal plant={plant} onClose={onClose} onPlanted={onPlanted} />);
    await tap(byText(document.body, "button", "Libro Físico"));
    return { plant, onPlanted, onClose };
  }
  const fields = () => [...document.querySelectorAll("input")] as HTMLInputElement[];
  const submit = () => byText(document.body, "button", "Plantar Semilla") as HTMLButtonElement;

  it("el boton espera titulo, autor y paginas", async () => {
    await openPhysical();
    expect(submit().disabled).toBe(true);
    typeInto(fields()[0], "Kokoro");
    typeInto(fields()[1], "Soseki");
    expect(submit().disabled).toBe(true);
    typeInto(fields()[2], "264");
    expect(submit().disabled).toBe(false);
  });

  it("el campo de paginas solo admite digitos", async () => {
    await openPhysical();
    typeInto(fields()[2], "2a6-4");
    expect(fields()[2]?.value).toBe("264");
  });

  it("planta con el total de paginas como numero", async () => {
    const { plant, onPlanted } = await openPhysical();
    typeInto(fields()[0], "Kokoro");
    typeInto(fields()[1], "Soseki");
    typeInto(fields()[2], "264");
    await tap(submit());
    expect(plant.plantPhysical).toHaveBeenCalledWith({ title: "Kokoro", author: "Soseki", total_pages: 264 });
    expect(onPlanted).toHaveBeenCalledTimes(1);
  });

  it("cero paginas se rechaza con un mensaje y no llama al servicio", async () => {
    const { plant } = await openPhysical();
    typeInto(fields()[0], "A");
    typeInto(fields()[1], "B");
    typeInto(fields()[2], "0");
    await tap(submit());
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("entero mayor a 0");
    expect(plant.plantPhysical).not.toHaveBeenCalled();
  });

  it("un error del almacenamiento se muestra y permite reintentar", async () => {
    const plantPhysical = vi
      .fn<PlantBookService["plantPhysical"]>()
      .mockRejectedValueOnce(new StorageQuotaError())
      .mockResolvedValueOnce(book());
    const { onPlanted } = await openPhysical(fakePlant({ plantPhysical }));
    typeInto(fields()[0], "A");
    typeInto(fields()[1], "B");
    typeInto(fields()[2], "10");
    await tap(submit());
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("No hay espacio suficiente");
    expect(onPlanted).not.toHaveBeenCalled();
    await tap(submit());
    expect(onPlanted).toHaveBeenCalledTimes(1);
  });

  it("Escape cierra la hoja", async () => {
    const { onClose } = await openPhysical();
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("PlantBookModal: .epub", () => {
  const epubFile = () => new File(["x"], "ficciones_borges.epub");
  const picker = () => document.querySelector('input[type="file"]');
  const text = () => document.body.textContent ?? "";
  const planButton = () => byText(document.body, "button", "Plantar Semilla") as HTMLButtonElement;

  function open(plant: PlantBookService, onPlanted = vi.fn(), onClose = vi.fn()) {
    mount(<PlantBookModal plant={plant} onClose={onClose} onPlanted={onPlanted} />);
    return { onPlanted, onClose };
  }

  it("la pestaña .epub esta activa por defecto y el boton espera un archivo", () => {
    open(fakePlant());
    expect(byText(document.body, "button", "Importar .epub")?.getAttribute("aria-selected")).toBe("true");
    expect(planButton().disabled).toBe(true);
  });

  it("al elegir un archivo rellena titulo y autor y deja plantar", async () => {
    const plant = fakePlant();
    const { onPlanted } = open(plant);
    await chooseFile(picker(), epubFile());
    const inputs = [...document.querySelectorAll('input:not([type="file"])')] as HTMLInputElement[];
    expect(inputs.map((i) => i.value)).toEqual(["Ficciones", "Borges"]);
    expect(planButton().disabled).toBe(false);
    await tap(planButton());
    expect(plant.plantEpub).toHaveBeenCalledWith(
      expect.anything(),
      { title: "Ficciones", author: "Borges" },
      expect.any(Function),
    );
    expect(onPlanted).toHaveBeenCalledTimes(1);
  });

  it("sin autor en el archivo, el lector lo escribe antes de plantar", async () => {
    const plant = fakePlant({
      prepareEpub: vi.fn(async () => ({ data: new ArrayBuffer(8), metadata: { title: "Ficciones", author: "" } })),
    });
    open(plant);
    await chooseFile(picker(), epubFile());
    expect(planButton().disabled).toBe(true);
    typeInto(document.querySelectorAll('input:not([type="file"])')[1], "Borges");
    expect(planButton().disabled).toBe(false);
  });

  it("sin titulo en el archivo, usa el nombre del archivo", async () => {
    const plant = fakePlant({
      prepareEpub: vi.fn(async () => ({ data: new ArrayBuffer(8), metadata: { title: "", author: "Borges" } })),
    });
    open(plant);
    await chooseFile(picker(), epubFile());
    expect((document.querySelector('input:not([type="file"])') as HTMLInputElement).value).toBe("ficciones borges");
  });

  it("DRM o archivo danado: aviso en alerta y la opcion de registrarlo como fisico (FA-2.2)", async () => {
    const plant = fakePlant({ prepareEpub: vi.fn(() => Promise.reject(new EpubImportError("drm"))) });
    open(plant);
    await chooseFile(picker(), epubFile());
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("protección (DRM)");
    expect(planButton().disabled).toBe(true);
    await tap(byText(document.body, "button", "Registrarlo como libro físico"));
    expect(byText(document.body, "button", "Libro Físico")?.getAttribute("aria-selected")).toBe("true");
    expect((document.querySelector('input:not([type="file"])') as HTMLInputElement).value).toBe("ficciones borges");
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it("muestra 'Preparando tu libro' mientras genera las locations y no se puede cerrar", async () => {
    let finish: (value: LocalBook) => void = () => {};
    const plant = fakePlant({
      plantEpub: vi.fn(
        (_p, _f, onPreparing) =>
          new Promise<LocalBook>((resolve) => {
            onPreparing?.();
            finish = resolve;
          }),
      ),
    });
    const { onPlanted, onClose } = open(plant);
    await chooseFile(picker(), epubFile());
    await tap(planButton());

    expect(document.querySelector('[role="status"]')?.textContent).toBe("Preparando tu libro");
    expect((document.querySelector(".zen-sheet__close") as HTMLButtonElement).disabled).toBe(true);
    expect(planButton().disabled).toBe(true);
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => finish(book({ format_type: "EPUB" })));
    expect(onPlanted).toHaveBeenCalledTimes(1);
  });

  it("si plantar falla, vuelve a poder intentarlo y avisa", async () => {
    const plantEpub = vi
      .fn<PlantBookService["plantEpub"]>()
      .mockRejectedValueOnce(new StorageQuotaError())
      .mockResolvedValueOnce(book());
    const plant = fakePlant({ plantEpub });
    const { onPlanted } = open(plant);
    await chooseFile(picker(), epubFile());
    await tap(planButton());
    expect(text()).toContain("No hay espacio suficiente");
    expect(planButton().disabled).toBe(false);
    await tap(planButton());
    expect(onPlanted).toHaveBeenCalledTimes(1);
  });

  it("no hay selector de variante (la elige pickVariant)", () => {
    open(fakePlant());
    expect(text()).not.toMatch(/Cl[aá]sica|Solar|Oto[nñ]al/);
  });

  it("sin emojis en el modal", () => {
    open(fakePlant());
    expect(text()).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});
