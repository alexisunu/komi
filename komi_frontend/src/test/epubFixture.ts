// Genera un .epub minimo y valido para pruebas, sin dependencias: un ZIP con entradas sin comprimir
// (metodo "store"). Sirve para ejercitar epubjs de verdad en jsdom.

const encoder = new TextEncoder();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** ZIP "store": cabecera local + datos por entrada, directorio central y fin de directorio. */
export function buildZip(files: ReadonlyArray<{ name: string; content: string | Uint8Array }>): ArrayBuffer {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = typeof file.content === "string" ? encoder.encode(file.content) : file.content;
    const crc = crc32(data);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    chunks.push(new Uint8Array(local.buffer), name, data);

    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, data.length, true);
    entry.setUint32(24, data.length, true);
    entry.setUint16(28, name.length, true);
    entry.setUint32(42, offset, true);
    central.push(new Uint8Array(entry.buffer), name);

    offset += 30 + name.length + data.length;
  }

  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);

  const all = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((sum, part) => sum + part.length, 0));
  let cursor = 0;
  for (const part of all) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out.buffer;
}

export interface EpubFixtureOptions {
  title?: string;
  creator?: string | null;
  /** Texto de cada capitulo (un parrafo por entrada). */
  chapters?: string[];
  mimetype?: string | null;
  encryptionXml?: string;
  rightsXml?: string;
}

export function buildEpub(options: EpubFixtureOptions = {}): ArrayBuffer {
  const { title = "El jardin de los senderos", creator = "Jorge Luis Borges" } = options;
  const chapters = options.chapters ?? ["Primer capitulo. ".repeat(80), "Segundo capitulo. ".repeat(80)];

  const files: Array<{ name: string; content: string }> = [];
  if (options.mimetype !== null) files.push({ name: "mimetype", content: options.mimetype ?? "application/epub+zip" });
  files.push({
    name: "META-INF/container.xml",
    content:
      '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">' +
      '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
  });
  if (options.encryptionXml) files.push({ name: "META-INF/encryption.xml", content: options.encryptionXml });
  if (options.rightsXml) files.push({ name: "META-INF/rights.xml", content: options.rightsXml });

  const manifest = chapters
    .map((_, i) => `<item id="c${i}" href="c${i}.xhtml" media-type="application/xhtml+xml"/>`)
    .join("");
  const spine = chapters.map((_, i) => `<itemref idref="c${i}"/>`).join("");
  const creatorXml = creator === null ? "" : `<dc:creator>${creator}</dc:creator>`;
  files.push({
    name: "OEBPS/content.opf",
    content:
      '<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">' +
      `<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:uuid:test-1</dc:identifier>` +
      `<dc:title>${title}</dc:title>${creatorXml}<dc:language>es</dc:language></metadata>` +
      `<manifest>${manifest}</manifest><spine>${spine}</spine></package>`,
  });
  chapters.forEach((text, i) => {
    files.push({
      name: `OEBPS/c${i}.xhtml`,
      content:
        '<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>c</title></head>' +
        `<body><p>${text}</p></body></html>`,
    });
  });
  return buildZip(files);
}
