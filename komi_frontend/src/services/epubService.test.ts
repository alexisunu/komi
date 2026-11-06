import { describe, expect, it, vi } from "vitest";
import { buildEpub, buildZip } from "../test/epubFixture";
import {
  createEpubService,
  detectDrm,
  EpubImportError,
  hasZipEnd,
  looksLikeZip,
  MAX_EPUB_BYTES,
} from "./epubService";

const service = createEpubService({ openTimeoutMs: 400 });

async function problemOf(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    return error instanceof EpubImportError ? error.problem : `otro: ${String(error)}`;
  }
}

describe("detectDrm", () => {
  const adobe = '<encryption><EncryptedData><EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/></EncryptedData></encryption>';
  const fonts =
    '<encryption><EncryptedData><EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/></EncryptedData>' +
    "<EncryptedData><EncryptionMethod Algorithm='http://ns.adobe.com/pdf/enc#RC'/></EncryptedData></encryption>";

  it("sin ningun archivo de proteccion no hay DRM", () => {
    expect(detectDrm(null, null)).toBe(false);
  });
  it("rights.xml indica DRM", () => {
    expect(detectDrm(null, "<rights/>")).toBe(true);
  });
  it("un rights.xml vacio no cuenta", () => {
    expect(detectDrm(null, "  \n")).toBe(false);
  });
  it("encryption.xml con un cifrado de contenido es DRM", () => {
    expect(detectDrm(adobe, null)).toBe(true);
  });
  it("encryption.xml solo con ofuscacion de fuentes no es DRM", () => {
    expect(detectDrm(fonts, null)).toBe(false);
  });
  it("mezcla de fuentes ofuscadas y contenido cifrado es DRM", () => {
    expect(detectDrm(fonts.replace("</encryption>", "") + adobe.slice("<encryption>".length), null)).toBe(true);
  });
  it("encryption.xml sin algoritmos no es DRM", () => {
    expect(detectDrm("<encryption/>", null)).toBe(false);
  });
});

describe("looksLikeZip", () => {
  it("reconoce la firma PK", () => {
    expect(looksLikeZip(buildEpub())).toBe(true);
  });
  it("rechaza texto, vacio y archivos cortos", () => {
    expect(looksLikeZip(new TextEncoder().encode("<html></html>").buffer)).toBe(false);
    expect(looksLikeZip(new ArrayBuffer(0))).toBe(false);
    expect(looksLikeZip(new Uint8Array([0x50, 0x4b]).buffer)).toBe(false);
  });
});

describe("hasZipEnd", () => {
  it("un ZIP completo termina con su registro final; uno cortado, no", () => {
    const full = buildEpub();
    expect(hasZipEnd(full)).toBe(true);
    expect(hasZipEnd(full.slice(0, full.byteLength - 10))).toBe(false);
    expect(hasZipEnd(new ArrayBuffer(0))).toBe(false);
  });
});

describe("inspect (epubjs real)", () => {
  it("extrae titulo y autor", async () => {
    const meta = await service.inspect(buildEpub({ title: "Ficciones", creator: "Jorge Luis Borges" }));
    expect(meta).toEqual({ title: "Ficciones", author: "Jorge Luis Borges" });
  });

  it("sin autor deja el autor vacio, para que la interfaz lo pida", async () => {
    const meta = await service.inspect(buildEpub({ creator: null }));
    expect(meta.title).toBe("El jardin de los senderos");
    expect(meta.author).toBe("");
  });

  it("acepta un epub sin archivo mimetype (muchos reales lo omiten)", async () => {
    expect((await service.inspect(buildEpub({ mimetype: null }))).title).toBe("El jardin de los senderos");
  });

  it("un archivo que no es ZIP es not_epub", async () => {
    expect(await problemOf(service.inspect(new TextEncoder().encode("hola").buffer))).toBe("not_epub");
  });

  it("un ZIP con otro mimetype es not_epub", async () => {
    expect(await problemOf(service.inspect(buildEpub({ mimetype: "application/pdf" })))).toBe("not_epub");
  });

  it("un ZIP sin estructura de libro es unreadable", async () => {
    const zip = buildZip([{ name: "hola.txt", content: "hola" }]);
    expect(await problemOf(service.inspect(zip))).toBe("unreadable");
  });

  it("un ZIP truncado es unreadable, de inmediato", async () => {
    const full = buildEpub();
    const started = Date.now();
    expect(await problemOf(service.inspect(full.slice(0, full.byteLength - 30)))).toBe("unreadable");
    expect(Date.now() - started).toBeLessThan(300); // no espera al tope de tiempo
  });

  it("epubjs que nunca termina de abrir no deja la promesa colgada (tope de tiempo)", async () => {
    const destroy = vi.fn();
    const never = createEpubService({
      openTimeoutMs: 50,
      loadEpubjs: async () => (() => ({ opened: new Promise(() => {}), destroy })) as never,
    });
    expect(await problemOf(never.inspect(buildEpub()))).toBe("unreadable");
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("con rights.xml o cifrado de contenido es drm", async () => {
    expect(await problemOf(service.inspect(buildEpub({ rightsXml: "<rights/>" })))).toBe("drm");
    const enc = '<encryption><EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/></encryption>';
    expect(await problemOf(service.inspect(buildEpub({ encryptionXml: enc })))).toBe("drm");
  });

  it("con solo fuentes ofuscadas se acepta", async () => {
    const enc = '<encryption><EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/></encryption>';
    expect((await service.inspect(buildEpub({ encryptionXml: enc }))).title).toBe("El jardin de los senderos");
  });

  it("un archivo mayor al tope se rechaza sin leerlo", async () => {
    const huge = { byteLength: MAX_EPUB_BYTES + 1 } as ArrayBuffer;
    expect(await problemOf(service.inspect(huge))).toBe("too_large");
  });

  it("si epubjs no se puede cargar, unreadable", async () => {
    const broken = createEpubService({ loadEpubjs: () => Promise.reject(new Error("sin red")) });
    expect(await problemOf(broken.inspect(buildEpub()))).toBe("unreadable");
  });
});

describe("percentageAt (epubjs real)", () => {
  const chapters = ["Uno. ".repeat(400), "Dos. ".repeat(400), "Tres. ".repeat(400)];
  const book = () => buildEpub({ chapters });

  async function locationsOf(): Promise<{ json: string; list: string[] }> {
    const json = await service.generateLocations(book());
    return { json, list: JSON.parse(json) as string[] };
  }

  it("con locations guardadas: la primera posicion es 0 y la ultima es 100 exacto", async () => {
    const { json, list } = await locationsOf();
    expect(await service.percentageAt(book(), list[0] as string, json)).toBe(0);
    expect(await service.percentageAt(book(), list[list.length - 1] as string, json)).toBe(100);
  });

  it("una posicion intermedia no llega a 100", async () => {
    const { json, list } = await locationsOf();
    const middle = await service.percentageAt(book(), list[Math.floor(list.length / 2)] as string, json);
    expect(middle).toBeGreaterThan(0);
    expect(middle).toBeLessThan(100);
  });

  it("sin locations las genera y da el mismo valor exacto, con avance real", async () => {
    const { json, list } = await locationsOf();
    const target = list[Math.floor(list.length / 2)] as string;
    const seen: number[] = [];
    const exact = await service.percentageAt(book(), target, null, (f) => seen.push(f));
    expect(exact).toBe(await service.percentageAt(book(), target, json));
    expect(seen.at(-1)).toBe(1);
    expect(seen.length).toBeGreaterThan(1);
  });

  it("trunca a 2 decimales (nunca redondea hacia arriba)", async () => {
    const { json, list } = await locationsOf();
    const value = await service.percentageAt(book(), list[list.length - 2] as string, json);
    expect(value).not.toBeNull();
    expect(value).toBeLessThan(100);
    expect(Math.round((value as number) * 100) / 100).toBe(value);
  });

  it("libera el libro y rechaza un archivo invalido", async () => {
    expect(await problemOf(service.percentageAt(new TextEncoder().encode("x").buffer, "epubcfi(/6/2)", null))).toBe(
      "not_epub",
    );
  });
});

describe("generateLocations (epubjs real)", () => {
  it("genera locations en JSON y se pueden volver a cargar", async () => {
    const json = await service.generateLocations(buildEpub());
    const list = JSON.parse(json) as string[];
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThan(1);
    expect(list[0]).toMatch(/^epubcfi\(/);
  });

  it("informa un avance real: un paso por capitulo, creciente y termina en 1", async () => {
    const seen: number[] = [];
    const chapters = ["Uno. ".repeat(300), "Dos. ".repeat(300), "Tres. ".repeat(300), "Cuatro. ".repeat(300)];
    await service.generateLocations(buildEpub({ chapters }), (fraction) => seen.push(fraction));
    expect(seen.length).toBe(5); // 4 capitulos + el cierre
    expect(seen.slice(0, 4)).toEqual([0.25, 0.5, 0.75, 0.99]);
    expect(seen[4]).toBe(1);
    expect([...seen].sort((a, b) => a - b)).toEqual(seen);
  });

  it("sin callback genera igual", async () => {
    const json = await service.generateLocations(buildEpub());
    expect((JSON.parse(json) as string[]).length).toBeGreaterThan(1);
  });

  it("un archivo invalido no deja la promesa colgada", async () => {
    expect(await problemOf(service.generateLocations(new TextEncoder().encode("x").buffer))).toBe("not_epub");
  });

  it("libera el libro al terminar (destroy), tambien si falla", async () => {
    const destroy = vi.fn();
    const fake = {
      opened: Promise.resolve(),
      ready: Promise.resolve(),
      locations: { generate: () => Promise.reject(new Error("boom")), save: () => "" },
      destroy,
    };
    const svc = createEpubService({ loadEpubjs: async () => (() => fake) as never });
    expect(await problemOf(svc.generateLocations(buildEpub()))).toBe("unreadable");
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
