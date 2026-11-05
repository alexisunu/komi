import { describe, expect, it, vi } from "vitest";
import { requestPersistentStorage, STORAGE_PERSIST_META_KEY } from "./persistStorage";

function setup(storage: Parameters<typeof requestPersistentStorage>[0]["storage"], metaFails = false) {
  const set = vi.fn(async () => {
    if (metaFails) throw new Error("sin espacio");
  });
  const log = vi.fn();
  return { set, log, run: () => requestPersistentStorage({ storage, meta: { set }, log }) };
}

describe("requestPersistentStorage", () => {
  it("pide persistencia y registra 'granted'", async () => {
    const persist = vi.fn(async () => true);
    const { run, set, log } = setup({ persist, persisted: async () => false });
    expect(await run()).toBe("granted");
    expect(persist).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith(STORAGE_PERSIST_META_KEY, "granted");
    expect(log).toHaveBeenCalledWith(expect.stringContaining("granted"));
  });

  it("registra 'denied' si el navegador la niega", async () => {
    const { run, set } = setup({ persist: async () => false, persisted: async () => false });
    expect(await run()).toBe("denied");
    expect(set).toHaveBeenCalledWith(STORAGE_PERSIST_META_KEY, "denied");
  });

  it("si ya era persistente no vuelve a pedirla", async () => {
    const persist = vi.fn(async () => true);
    const { run, set } = setup({ persist, persisted: async () => true });
    expect(await run()).toBe("already");
    expect(persist).not.toHaveBeenCalled();
    expect(set).toHaveBeenCalledWith(STORAGE_PERSIST_META_KEY, "already");
  });

  it("sin `persisted` igual pide persistencia", async () => {
    const persist = vi.fn(async () => true);
    const { run } = setup({ persist });
    expect(await run()).toBe("granted");
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("sin la API devuelve 'unsupported' y lo registra", async () => {
    const { run, set, log } = setup(undefined);
    expect(await run()).toBe("unsupported");
    expect(set).toHaveBeenCalledWith(STORAGE_PERSIST_META_KEY, "unsupported");
    expect(log).toHaveBeenCalledWith(expect.stringContaining("unsupported"));
  });

  it("si persist() lanza, devuelve 'error' sin lanzar", async () => {
    const { run, set } = setup({
      persist: async () => {
        throw new Error("boom");
      },
    });
    expect(await run()).toBe("error");
    expect(set).toHaveBeenCalledWith(STORAGE_PERSIST_META_KEY, "error");
  });

  it("si guardar el resultado falla, no lanza y el resultado se conserva", async () => {
    const { run } = setup({ persist: async () => true }, true);
    expect(await run()).toBe("granted");
  });
});
