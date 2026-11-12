import { describe, expect, it, vi } from "vitest";
import {
  createProgressWriter,
  earlyFinishAllowed,
  createReadingTracker,
  isFinished,
  MAX_EXCERPT_CHARS,
  parseReadingProgress,
  PROGRESS_WRITE_MS,
  toPercentage,
  type ReadingProgress,
} from "./readingTracker";

const SENTENCE = "El sol entraba por la ventana y el libro seguia abierto sobre la mesa. ";

function tracker() {
  return createReadingTracker("s1", () => 1_000);
}

describe("toPercentage e isFinished (borde del 100 %)", () => {
  it("trunca a 2 decimales y no redondea hacia arriba", () => {
    expect(toPercentage(0.5)).toBe(50);
    expect(toPercentage(0.3333333)).toBe(33.33);
    expect(toPercentage(0.99999)).toBe(99.99);
    expect(toPercentage(0.999999999)).toBe(99.99);
  });

  it("solo el 1 exacto da 100", () => {
    expect(toPercentage(1)).toBe(100);
    expect(toPercentage(1.0000001)).toBe(100);
    expect(toPercentage(0)).toBe(0);
    expect(toPercentage(-0.2)).toBe(0);
  });

  it("sin locations (null) o con basura no hay porcentaje", () => {
    expect(toPercentage(null)).toBeNull();
    expect(toPercentage(Number.NaN)).toBeNull();
    expect(toPercentage(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("99,99 no cuenta como terminado; 100 si; null no", () => {
    expect(isFinished(99.99)).toBe(false);
    expect(isFinished(toPercentage(0.99995))).toBe(false);
    expect(isFinished(100)).toBe(true);
    expect(isFinished(toPercentage(1))).toBe(true);
    expect(isFinished(null)).toBe(false);
  });
});

describe("earlyFinishAllowed (FA-3.3)", () => {
  it("el 50 % del tiempo basta sin importar el libro", () => {
    expect(earlyFinishAllowed({ belowHalf: false }, 5)).toBe(true);
    expect(earlyFinishAllowed({ belowHalf: false }, null)).toBe(true);
  });

  it("bajo el 50 % solo vale con el libro terminado (100 exacto)", () => {
    expect(earlyFinishAllowed({ belowHalf: true }, 100)).toBe(true);
    expect(earlyFinishAllowed({ belowHalf: true }, 99.99)).toBe(false);
    expect(earlyFinishAllowed({ belowHalf: true }, null)).toBe(false);
  });

  it("sin sesion no hay nada que aceptar", () => {
    expect(earlyFinishAllowed(null, 100)).toBe(false);
  });
});

describe("createReadingTracker", () => {
  it("empieza vacio", () => {
    expect(tracker().snapshot()).toMatchObject({ sessionId: "s1", cfi: null, percentage: null, excerpt: "" });
  });

  it("conserva el ultimo cfi y porcentaje", () => {
    const t = tracker();
    t.record({ cfi: "a", percentage: 10, text: "" });
    t.record({ cfi: "b", percentage: 12.5, text: "" });
    expect(t.snapshot()).toMatchObject({ cfi: "b", percentage: 12.5 });
  });

  it("un porcentaje nulo no borra el ultimo valido ni inventa otro", () => {
    const t = tracker();
    t.record({ cfi: "a", percentage: 40, text: "" });
    t.record({ cfi: "b", percentage: null, text: "" });
    expect(t.snapshot()).toMatchObject({ cfi: "b", percentage: 40 });
    const fresh = tracker();
    fresh.record({ cfi: "a", percentage: null, text: SENTENCE });
    expect(fresh.snapshot().percentage).toBeNull();
  });

  it("acumula los textos nuevos en orden", () => {
    const t = tracker();
    t.record({ cfi: "a", percentage: 1, text: "Primera pagina con bastante texto para contar." });
    t.record({ cfi: "b", percentage: 2, text: "Segunda pagina con bastante texto para contar." });
    expect(t.snapshot().excerpt).toBe(
      "Primera pagina con bastante texto para contar. Segunda pagina con bastante texto para contar.",
    );
  });

  it("no duplica una pagina ya leida (volver atras)", () => {
    const t = tracker();
    const page = "Una pagina completa que se lee dos veces seguidas.";
    expect(t.record({ cfi: "a", percentage: 1, text: page })).toBe(true);
    expect(t.record({ cfi: "a", percentage: 1, text: page })).toBe(false);
    t.record({ cfi: "b", percentage: 2, text: "Otra pagina distinta que tambien cuenta." });
    t.record({ cfi: "a", percentage: 1, text: page });
    expect(t.snapshot().excerpt.split(page)).toHaveLength(2);
  });

  it("ignora diferencias de espacios y saltos de linea al comparar", () => {
    const t = tracker();
    t.record({ cfi: "a", percentage: 1, text: "Una frase   con\n espacios raros dentro." });
    t.record({ cfi: "a", percentage: 1, text: "Una frase con espacios raros dentro." });
    expect(t.snapshot().excerpt).toBe("Una frase con espacios raros dentro.");
  });

  it("descarta fragmentos demasiado cortos (numeros de pagina)", () => {
    const t = tracker();
    expect(t.record({ cfi: "a", percentage: 1, text: " 42 " })).toBe(true); // el cfi si cambio
    expect(t.snapshot().excerpt).toBe("");
    expect(t.record({ cfi: "a", percentage: 1, text: "43" })).toBe(false);
  });

  it("recorta por el inicio al pasar de 20 000 caracteres y conserva lo ultimo", () => {
    const t = tracker();
    for (let i = 0; i < 400; i += 1) {
      t.record({ cfi: `c${i}`, percentage: 1, text: `${SENTENCE.repeat(2)} Pagina numero ${i} termina aqui.` });
    }
    const excerpt = t.snapshot().excerpt;
    expect(excerpt.length).toBeLessThanOrEqual(MAX_EXCERPT_CHARS);
    expect(excerpt.length).toBeGreaterThan(MAX_EXCERPT_CHARS - 200);
    expect(excerpt.endsWith("Pagina numero 399 termina aqui.")).toBe(true);
    expect(excerpt).not.toContain("Pagina numero 0 termina aqui.");
  });

  it("restore reanuda solo la misma sesion", () => {
    const saved: ReadingProgress = { sessionId: "s1", cfi: "x", percentage: 20, excerpt: "guardado", updatedAt: 1 };
    const t = tracker();
    t.restore(saved);
    expect(t.snapshot()).toMatchObject({ cfi: "x", percentage: 20, excerpt: "guardado" });
    const other = tracker();
    other.restore({ ...saved, sessionId: "otra" });
    expect(other.snapshot()).toMatchObject({ cfi: null, percentage: null, excerpt: "" });
  });
});

describe("parseReadingProgress", () => {
  const ok = { sessionId: "s", cfi: "c", percentage: 5, excerpt: "e", updatedAt: 1 };
  it("acepta un registro valido, con cfi y porcentaje nulos", () => {
    expect(parseReadingProgress(JSON.stringify(ok))).toEqual(ok);
    expect(parseReadingProgress(JSON.stringify({ ...ok, cfi: null, percentage: null }))).toMatchObject({
      cfi: null,
      percentage: null,
    });
  });

  it("rechaza basura", () => {
    expect(parseReadingProgress(undefined)).toBeNull();
    expect(parseReadingProgress("no es json")).toBeNull();
    expect(parseReadingProgress("5")).toBeNull();
    expect(parseReadingProgress(JSON.stringify({ ...ok, sessionId: "" }))).toBeNull();
    expect(parseReadingProgress(JSON.stringify({ ...ok, percentage: 101 }))).toBeNull();
    expect(parseReadingProgress(JSON.stringify({ ...ok, percentage: "5" }))).toBeNull();
    expect(parseReadingProgress(JSON.stringify({ ...ok, excerpt: 3 }))).toBeNull();
  });

  it("recorta un extracto demasiado largo", () => {
    const parsed = parseReadingProgress(JSON.stringify({ ...ok, excerpt: "x".repeat(MAX_EXCERPT_CHARS + 50) }));
    expect(parsed?.excerpt).toHaveLength(MAX_EXCERPT_CHARS);
  });
});

describe("createProgressWriter (posicion al instante, extracto cada ~10 s)", () => {
  function setup() {
    let clock = 100_000;
    const save = vi.fn<(progress: ReadingProgress) => Promise<void>>(async () => {});
    const writer = createProgressWriter({ now: () => clock, save });
    const progress = (n: number, excerpt = ""): ReadingProgress => ({
      sessionId: "s",
      cfi: `c${n}`,
      percentage: n,
      excerpt,
      updatedAt: n,
    });
    return { writer, save, progress, advance: (ms: number) => (clock += ms) };
  }

  it("la primera actualizacion escribe de inmediato", async () => {
    const { writer, save, progress } = setup();
    await writer.update(progress(1));
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("cada cambio de pagina (CFI o porcentaje) se escribe al instante, sin esperar el intervalo", async () => {
    const { writer, save, progress } = setup();
    await writer.update(progress(1));
    await writer.update(progress(2));
    await writer.update(progress(3));
    expect(save.mock.calls.map((call) => call[0].cfi)).toEqual(["c1", "c2", "c3"]);
  });

  it("un cambio que no mueve la posicion (solo el extracto) espera 10 s y guarda lo ultimo", async () => {
    const { writer, save, progress, advance } = setup();
    await writer.update(progress(1));
    advance(PROGRESS_WRITE_MS - 1);
    await writer.update(progress(1, "uno"));
    await writer.update(progress(1, "uno dos"));
    expect(save).toHaveBeenCalledTimes(1);
    advance(1);
    await writer.flushIfDue();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]?.[0].excerpt).toBe("uno dos");
  });

  it("flush escribe ya lo pendiente, sin esperar el intervalo (pagehide, pestana oculta)", async () => {
    const { writer, save, progress } = setup();
    await writer.update(progress(1));
    await writer.update(progress(1, "texto nuevo"));
    expect(save).toHaveBeenCalledTimes(1);
    await writer.flush();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]?.[0].excerpt).toBe("texto nuevo");
  });

  it("las escrituras salen en orden aunque la primera tarde", async () => {
    const { writer, save, progress } = setup();
    let release: () => void = () => {};
    save.mockImplementationOnce(() => new Promise<void>((resolve) => (release = resolve)));
    const first = writer.update(progress(1));
    const second = writer.update(progress(2));
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls.map((call) => call[0].cfi)).toEqual(["c1"]); // la segunda espera a la primera
    release();
    await Promise.all([first, second]);
    expect(save.mock.calls.map((call) => call[0].cfi)).toEqual(["c1", "c2"]);
  });

  it("sin nada pendiente no escribe", async () => {
    const { writer, save, progress, advance } = setup();
    await writer.update(progress(1));
    advance(60_000);
    await writer.flushIfDue();
    await writer.flush();
    expect(save).toHaveBeenCalledTimes(1);
    expect(writer.hasPending()).toBe(false);
  });

  it("si guardar falla, no lanza y se reintenta con lo pendiente", async () => {
    const { writer, save, progress, advance } = setup();
    save.mockRejectedValueOnce(new Error("sin espacio"));
    await expect(writer.update(progress(1))).resolves.toBeUndefined();
    expect(writer.hasPending()).toBe(true);
    advance(PROGRESS_WRITE_MS);
    await writer.flushIfDue();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]?.[0].cfi).toBe("c1");
  });
});
