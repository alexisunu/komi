// Lector EPUB falso para pruebas: epubjs no dibuja paginas en jsdom. Se controla a mano que
// posiciones "ve" el lector y se comprueba como lo usa la pantalla.

import { vi } from "vitest";
import type { EpubReaderService, OpenReaderInput, ReaderHandle, ReaderPosition } from "../services/epubReaderService";

export function createFakeReader() {
  const handle = {
    next: vi.fn(async () => {}),
    prev: vi.fn(async () => {}),
    setTheme: vi.fn(),
    resize: vi.fn(),
    destroy: vi.fn(),
  } satisfies ReaderHandle;
  let onPosition: (position: ReaderPosition) => void = () => {};
  const inputs: OpenReaderInput[] = [];
  const open = vi.fn(async (input: OpenReaderInput) => {
    inputs.push(input);
    onPosition = input.onPosition;
    return handle;
  });
  const reader: EpubReaderService = { open };
  return {
    reader,
    handle,
    open,
    inputs,
    /** El lector "ve" una pagina nueva. */
    see(position: ReaderPosition) {
      onPosition(position);
    },
  };
}

export type FakeReader = ReturnType<typeof createFakeReader>;
