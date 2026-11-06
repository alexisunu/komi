import { describe, expect, it } from "vitest";
import {
  createWakeLockService,
  type WakeLockDocument,
  type WakeLockNavigator,
  type WakeLockSentinelLike,
} from "./wakeLockService";

function setup(options: { supported?: boolean; failFirst?: boolean } = {}) {
  let visibility: DocumentVisibilityState = "visible";
  const handlers = new Set<() => void>();
  const doc: WakeLockDocument = {
    get visibilityState() {
      return visibility;
    },
    addEventListener: (_t, fn) => void handlers.add(fn),
    removeEventListener: (_t, fn) => void handlers.delete(fn),
  };

  const sentinels: Array<{ released: boolean; onRelease: Array<() => void> }> = [];
  let requests = 0;
  let pending: (() => void) | null = null;
  let hold = false;
  const nav: WakeLockNavigator =
    options.supported === false
      ? {}
      : {
          wakeLock: {
            request: async () => {
              requests += 1;
              if (options.failFirst && requests === 1) throw new Error("NotAllowedError");
              if (hold) await new Promise<void>((resolve) => (pending = resolve));
              const state = { released: false, onRelease: [] as Array<() => void> };
              sentinels.push(state);
              const sentinel: WakeLockSentinelLike = {
                release: async () => {
                  state.released = true;
                },
                addEventListener: (_type, fn) => void state.onRelease.push(fn),
              };
              return sentinel;
            },
          },
        };

  const service = createWakeLockService(nav, doc);
  return {
    service,
    sentinels,
    requests: () => requests,
    listeners: () => handlers.size,
    holdNext() {
      hold = true;
    },
    resolvePending() {
      hold = false;
      pending?.();
    },
    /** El sistema suelta el bloqueo al ocultarse la pagina. */
    systemRelease() {
      const last = sentinels[sentinels.length - 1];
      if (last) {
        last.released = true;
        last.onRelease.forEach((fn) => fn());
      }
    },
    hide() {
      visibility = "hidden";
      handlers.forEach((fn) => fn());
    },
    async show() {
      visibility = "visible";
      handlers.forEach((fn) => fn());
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

describe("wakeLockService", () => {
  it("pide la pantalla encendida al iniciar", async () => {
    const t = setup();
    await t.service.acquire();
    expect(t.requests()).toBe(1);
    expect(t.sentinels[0]?.released).toBe(false);
  });

  it("al terminar lo libera y deja de escuchar", async () => {
    const t = setup();
    await t.service.acquire();
    await t.service.release();
    expect(t.sentinels[0]?.released).toBe(true);
    expect(t.listeners()).toBe(0);
  });

  it("lo vuelve a pedir al ser visible otra vez tras la liberacion del sistema", async () => {
    const t = setup();
    await t.service.acquire();
    t.hide();
    t.systemRelease();
    await t.show();
    expect(t.requests()).toBe(2);
    expect(t.sentinels[1]?.released).toBe(false);
  });

  it("no pide de nuevo si el bloqueo sigue vigente", async () => {
    const t = setup();
    await t.service.acquire();
    t.hide();
    await t.show();
    expect(t.requests()).toBe(1);
  });

  it("oculta no pide; tras release no vuelve a pedir al mostrarse", async () => {
    const t = setup();
    await t.service.acquire();
    t.hide();
    t.systemRelease();
    await t.service.release();
    await t.show();
    expect(t.requests()).toBe(1);
  });

  it("sin soporte de la API no falla ni avisa", async () => {
    const t = setup({ supported: false });
    await expect(t.service.acquire()).resolves.toBeUndefined();
    await expect(t.service.release()).resolves.toBeUndefined();
  });

  it("si la peticion falla, sigue en silencio y reintenta al volver a ser visible", async () => {
    const t = setup({ failFirst: true });
    await expect(t.service.acquire()).resolves.toBeUndefined();
    expect(t.sentinels).toHaveLength(0);
    await t.show();
    expect(t.requests()).toBe(2);
    expect(t.sentinels).toHaveLength(1);
  });

  it("si se suelta mientras llega la respuesta, el bloqueo concedido se libera", async () => {
    const t = setup();
    t.holdNext();
    const acquiring = t.service.acquire();
    await t.service.release();
    t.resolvePending();
    await acquiring;
    expect(t.sentinels[0]?.released).toBe(true);
  });

  it("acquire repetido no duplica peticiones ni escuchas", async () => {
    const t = setup();
    await t.service.acquire();
    await t.service.acquire();
    expect(t.requests()).toBe(1);
    expect(t.listeners()).toBe(1);
  });
});
