import { describe, expect, it, vi } from "vitest";
import { createReloadGate } from "./reloadGate";
import { registerServiceWorker, type WorkboxLike } from "./registerServiceWorker";

function fakeWorkbox() {
  const listeners: Array<(event: { isUpdate?: boolean }) => void> = [];
  const workbox: WorkboxLike = {
    addEventListener: (_type, listener) => {
      listeners.push(listener);
    },
    register: vi.fn(async () => undefined),
  };
  return { workbox, emit: (event: { isUpdate?: boolean }) => listeners.forEach((l) => l(event)) };
}

describe("registerServiceWorker", () => {
  it("no hace nada si el navegador no soporta Service Worker", async () => {
    const create = vi.fn();
    const ok = await registerServiceWorker({ supported: false, create, gate: createReloadGate(vi.fn()) });
    expect(ok).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  it("registra y devuelve true", async () => {
    const { workbox } = fakeWorkbox();
    const ok = await registerServiceWorker({ supported: true, create: () => workbox, gate: createReloadGate(vi.fn()) });
    expect(ok).toBe(true);
    expect(workbox.register).toHaveBeenCalledTimes(1);
  });

  it("al activarse una version nueva pide la recarga a la puerta", async () => {
    const reload = vi.fn();
    const { workbox, emit } = fakeWorkbox();
    await registerServiceWorker({ supported: true, create: () => workbox, gate: createReloadGate(reload) });
    emit({ isUpdate: true });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("la primera instalacion no recarga", async () => {
    const reload = vi.fn();
    const { workbox, emit } = fakeWorkbox();
    await registerServiceWorker({ supported: true, create: () => workbox, gate: createReloadGate(reload) });
    emit({ isUpdate: false });
    emit({});
    expect(reload).not.toHaveBeenCalled();
  });

  it("si la puerta esta bloqueada, la actualizacion espera", async () => {
    const reload = vi.fn();
    const gate = createReloadGate(reload);
    const release = gate.block();
    const { workbox, emit } = fakeWorkbox();
    await registerServiceWorker({ supported: true, create: () => workbox, gate });
    emit({ isUpdate: true });
    expect(reload).not.toHaveBeenCalled();
    release();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("si el registro falla, no lanza: lo registra y devuelve false", async () => {
    const log = vi.fn();
    const workbox: WorkboxLike = {
      addEventListener: () => {},
      register: async () => {
        throw new Error("sin SW");
      },
    };
    const ok = await registerServiceWorker({ supported: true, create: () => workbox, gate: createReloadGate(vi.fn()), log });
    expect(ok).toBe(false);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("si crear el Workbox falla, tampoco lanza", async () => {
    const log = vi.fn();
    const ok = await registerServiceWorker({
      supported: true,
      create: () => {
        throw new Error("boom");
      },
      gate: createReloadGate(vi.fn()),
      log,
    });
    expect(ok).toBe(false);
    expect(log).toHaveBeenCalled();
  });
});
