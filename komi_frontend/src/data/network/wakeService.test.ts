import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./apiClient";
import {
  HEALTH_PATH,
  WAKE_BUDGET_MS,
  WAKE_FRESH_MS,
  WAKE_RETRY_MS,
  WAKE_SLOW_AFTER_MS,
  createWakeService,
  watchWake,
  type WakeState,
} from "./wakeService";

type Step =
  | { ok: true; after?: number }
  | { ok: false; after?: number; error: ApiError };

const ok = (after = 0): Step => ({ ok: true, after });
const http = (status: number, after = 0): Step => ({
  ok: false,
  after,
  error: new ApiError("http", "x", status, status >= 500),
});
const network = (after = 0): Step => ({ ok: false, after, error: new ApiError("network", "x", null, true) });
const notConfigured: Step = {
  ok: false,
  error: new ApiError("not_configured", "x", null, false),
};

/** Cliente HTTP falso: cada llamada consume un paso; el ultimo se repite. */
function fakeApi(steps: Step[], configured = true) {
  const calls: Array<{ path: string; timeoutMs: number | undefined }> = [];
  let index = 0;
  return {
    calls,
    api: {
      isConfigured: configured,
      get: vi.fn(async (path: string, options?: { timeoutMs?: number }) => {
        calls.push({ path, timeoutMs: options?.timeoutMs });
        const step = steps[Math.min(index, steps.length - 1)]!;
        index += 1;
        if (step.after) await new Promise((resolve) => setTimeout(resolve, step.after));
        if (step.ok) return { status: 200, data: { status: "ok" } };
        throw step.error;
      }),
    },
  };
}

function build(steps: Step[], extra: { online?: () => boolean; configured?: boolean } = {}) {
  const fake = fakeApi(steps, extra.configured ?? true);
  const wake = createWakeService({
    api: fake.api as never,
    ...(extra.online ? { isOnline: extra.online } : {}),
  });
  const seen: WakeState[] = [];
  wake.subscribe(() => seen.push(wake.state()));
  return { ...fake, wake, seen };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-06T10:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("sondeo de despertar", () => {
  it("un servidor despierto responde rapido y no muestra nunca 'despertando'", async () => {
    const { wake, seen, calls } = build([ok(150)]);
    const done = wake.start();
    await vi.advanceTimersByTimeAsync(200);
    await done;
    expect(wake.state()).toBe("awake");
    expect(seen).toEqual(["awake"]);
    expect(calls).toEqual([{ path: HEALTH_PATH, timeoutMs: WAKE_BUDGET_MS }]);
  });

  it("una respuesta justo antes del umbral tampoco muestra 'despertando'", async () => {
    const { wake, seen } = build([ok(WAKE_SLOW_AFTER_MS - 100)]);
    const done = wake.start();
    await vi.advanceTimersByTimeAsync(WAKE_SLOW_AFTER_MS);
    await done;
    expect(seen).toEqual(["awake"]);
  });

  it("un arranque en frio muestra 'despertando' pasado el umbral y termina despierto", async () => {
    const { wake, seen } = build([ok(40_000)]);
    const done = wake.start();
    await vi.advanceTimersByTimeAsync(WAKE_SLOW_AFTER_MS - 1);
    expect(wake.state()).toBe("idle");
    await vi.advanceTimersByTimeAsync(2);
    expect(wake.state()).toBe("waking");
    await vi.advanceTimersByTimeAsync(40_000);
    await done;
    expect(wake.state()).toBe("awake");
    expect(seen).toEqual(["waking", "awake"]);
  });

  it("un 503 se reintenta cada pocos segundos hasta que responde", async () => {
    const { wake, calls } = build([http(503), http(502), ok()]);
    const done = wake.start();
    await vi.advanceTimersByTimeAsync(WAKE_RETRY_MS * 2 + 50);
    await done;
    expect(calls).toHaveLength(3);
    expect(wake.state()).toBe("awake");
  });

  it("cada reintento recibe lo que queda del presupuesto, nunca mas", async () => {
    const { wake, calls } = build([http(503), http(503), ok()]);
    const done = wake.start();
    await vi.advanceTimersByTimeAsync(WAKE_RETRY_MS * 2 + 50);
    await done;
    expect(calls.map((c) => c.timeoutMs)).toEqual([
      WAKE_BUDGET_MS,
      WAKE_BUDGET_MS - WAKE_RETRY_MS,
      WAKE_BUDGET_MS - WAKE_RETRY_MS * 2,
    ]);
  });

  it("un fallo sin respuesta con la red activa se toma por arranque (un 502 sin CORS lo parece)", async () => {
    const { wake, calls } = build([network(), network(), ok()], { online: () => true });
    const done = wake.start();
    await vi.advanceTimersByTimeAsync(WAKE_RETRY_MS * 2 + 50);
    await done;
    expect(calls).toHaveLength(3);
    expect(wake.state()).toBe("awake");
  });

  it("sin red del dispositivo se para en seguida: offline y sin reintentos", async () => {
    const { wake, calls, seen } = build([network()], { online: () => false });
    await wake.start();
    expect(wake.state()).toBe("offline");
    expect(calls).toHaveLength(1);
    expect(seen).toEqual(["offline"]);
  });

  it("agotados los 90 s sin respuesta queda offline", async () => {
    const { wake, calls } = build([http(503)]);
    const done = wake.start();
    await vi.advanceTimersByTimeAsync(WAKE_BUDGET_MS + WAKE_RETRY_MS);
    await done;
    expect(wake.state()).toBe("offline");
    expect(calls.length).toBeGreaterThan(20);
    expect(calls.length).toBeLessThanOrEqual(WAKE_BUDGET_MS / WAKE_RETRY_MS + 2);
  });

  it("una peticion que se queda esperando mas de 90 s acaba en offline", async () => {
    const { wake } = build([{ ok: false, after: 0, error: new ApiError("timeout", "x", null, true) }]);
    const done = wake.start();
    await vi.advanceTimersByTimeAsync(WAKE_BUDGET_MS + WAKE_RETRY_MS);
    await done;
    expect(wake.state()).toBe("offline");
  });

  it("una respuesta de la propia aplicacion (404, 429, 500) significa despierto", async () => {
    for (const status of [404, 429, 500, 501]) {
      const { wake, calls } = build([http(status)]);
      await wake.start();
      expect(wake.state(), String(status)).toBe("awake");
      expect(calls).toHaveLength(1);
    }
  });

  it("502, 503 y 504 son del proxy mientras arranca: sigue esperando", async () => {
    for (const status of [502, 503, 504]) {
      const { wake, calls } = build([http(status), ok()]);
      const done = wake.start();
      await vi.advanceTimersByTimeAsync(WAKE_RETRY_MS + 50);
      await done;
      expect(calls, String(status)).toHaveLength(2);
    }
  });

  it("sin servidor configurado no hace nada", async () => {
    const { wake, calls } = build([notConfigured], { configured: false });
    await wake.start();
    expect(calls).toHaveLength(0);
    expect(wake.state()).toBe("idle");
    expect(await wake.ensureAwake()).toBe(false);
  });

  it("not_configured devuelto por el cliente deja el estado en idle", async () => {
    const { wake } = build([notConfigured]);
    await wake.start();
    expect(wake.state()).toBe("idle");
  });

  it("dos aperturas seguidas comparten un solo sondeo", async () => {
    const { wake, calls } = build([ok(500)]);
    const first = wake.start();
    const second = wake.start();
    await vi.advanceTimersByTimeAsync(600);
    await Promise.all([first, second]);
    expect(calls).toHaveLength(1);
  });

  it("start nunca lanza ni deja una promesa rechazada", async () => {
    const api = { isConfigured: true, get: vi.fn().mockRejectedValue(new Error("raro")) };
    const wake = createWakeService({ api: api as never });
    const done = wake.start();
    await vi.advanceTimersByTimeAsync(WAKE_BUDGET_MS + WAKE_RETRY_MS);
    await expect(done).resolves.toBeUndefined();
    expect(wake.state()).toBe("offline");
  });
});

describe("caducidad", () => {
  it("despierto dura 10 minutos y no repite el sondeo antes", async () => {
    const { wake, calls } = build([ok()]);
    await wake.start();
    await vi.advanceTimersByTimeAsync(WAKE_FRESH_MS - 1000);
    expect(wake.state()).toBe("awake");
    await wake.start();
    expect(calls).toHaveLength(1);
  });

  it("pasados los 10 minutos vuelve a idle y el siguiente start sondea otra vez", async () => {
    const { wake, calls } = build([ok()]);
    await wake.start();
    await vi.advanceTimersByTimeAsync(WAKE_FRESH_MS + 1000);
    expect(wake.state()).toBe("idle");
    await wake.start();
    expect(calls).toHaveLength(2);
    expect(wake.state()).toBe("awake");
  });

  it("la caducidad es menor que los ~15 minutos tras los que duerme el plan gratuito", () => {
    expect(WAKE_FRESH_MS).toBeLessThan(15 * 60_000);
    expect(WAKE_BUDGET_MS).toBe(90_000);
  });
});

describe("ensureAwake", () => {
  it("responde de inmediato si ya esta despierto", async () => {
    const { wake, calls } = build([ok()]);
    await wake.start();
    expect(await wake.ensureAwake()).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("espera al arranque en frio y devuelve verdadero cuando responde", async () => {
    const { wake } = build([ok(30_000)]);
    const result = wake.ensureAwake();
    await vi.advanceTimersByTimeAsync(30_100);
    expect(await result).toBe(true);
  });

  it("no espera mas de lo pedido: falso, y el sondeo sigue en segundo plano", async () => {
    const { wake } = build([ok(60_000)]);
    const result = wake.ensureAwake(5_000);
    await vi.advanceTimersByTimeAsync(5_100);
    expect(await result).toBe(false);
    expect(wake.state()).toBe("waking");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(wake.state()).toBe("awake");
  });

  it("sin red devuelve falso enseguida", async () => {
    const { wake } = build([network()], { online: () => false });
    expect(await wake.ensureAwake()).toBe(false);
    expect(wake.state()).toBe("offline");
  });

  it("si no hay respuesta en 90 s devuelve falso", async () => {
    const { wake } = build([http(503)]);
    const result = wake.ensureAwake();
    await vi.advanceTimersByTimeAsync(WAKE_BUDGET_MS + WAKE_RETRY_MS);
    expect(await result).toBe(false);
  });

  it("reutiliza el sondeo de la apertura en lugar de lanzar otro", async () => {
    const { wake, calls } = build([ok(8_000)]);
    void wake.start();
    const result = wake.ensureAwake();
    await vi.advanceTimersByTimeAsync(8_100);
    expect(await result).toBe(true);
    expect(calls).toHaveLength(1);
  });
});

describe("watchWake", () => {
  function targets() {
    const win = new EventTarget();
    const doc = Object.assign(new EventTarget(), { visibilityState: "visible" as DocumentVisibilityState });
    return { win: win as unknown as Window, doc: doc as unknown as Document, raw: { win, doc } };
  }

  it("despierta al abrir, al volver la red y al volver a la pestana visible", async () => {
    const start = vi.fn(() => Promise.resolve());
    const wake = { start, state: () => "idle" as WakeState, subscribe: () => () => {} };
    const { win, doc, raw } = targets();
    const stop = watchWake(wake, win, doc);
    expect(start).toHaveBeenCalledTimes(1);
    raw.win.dispatchEvent(new Event("online"));
    expect(start).toHaveBeenCalledTimes(2);
    raw.doc.dispatchEvent(new Event("visibilitychange"));
    expect(start).toHaveBeenCalledTimes(3);
    stop();
  });

  it("no despierta al ocultarse la pestana", () => {
    const start = vi.fn(() => Promise.resolve());
    const wake = { start, state: () => "idle" as WakeState, subscribe: () => () => {} };
    const { win, doc, raw } = targets();
    watchWake(wake, win, doc);
    (raw.doc as unknown as { visibilityState: string }).visibilityState = "hidden";
    raw.doc.dispatchEvent(new Event("visibilitychange"));
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("al detenerse deja de escuchar", () => {
    const start = vi.fn(() => Promise.resolve());
    const wake = { start, state: () => "idle" as WakeState, subscribe: () => () => {} };
    const { win, doc, raw } = targets();
    watchWake(wake, win, doc)();
    raw.win.dispatchEvent(new Event("online"));
    raw.doc.dispatchEvent(new Event("visibilitychange"));
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("avisa al pasar de despertando a despierto, y solo entonces", async () => {
    const { wake } = build([ok(10_000)]);
    const onAwake = vi.fn();
    const { win, doc } = targets();
    watchWake(wake, win, doc, onAwake);
    await vi.advanceTimersByTimeAsync(WAKE_SLOW_AFTER_MS + 100);
    expect(wake.state()).toBe("waking");
    expect(onAwake).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(onAwake).toHaveBeenCalledTimes(1);
  });

  it("al detenerse ya no avisa del despertar", async () => {
    const { wake } = build([ok(10_000)]);
    const onAwake = vi.fn();
    const { win, doc } = targets();
    const stop = watchWake(wake, win, doc, onAwake);
    await vi.advanceTimersByTimeAsync(WAKE_SLOW_AFTER_MS + 100);
    expect(wake.state()).toBe("waking");
    stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(wake.state()).toBe("awake");
    expect(onAwake).not.toHaveBeenCalled();
  });

  it("no avisa si el servidor respondio rapido (nada se quedo pendiente por el arranque)", async () => {
    const { wake } = build([ok(100)]);
    const onAwake = vi.fn();
    const { win, doc } = targets();
    watchWake(wake, win, doc, onAwake);
    await vi.advanceTimersByTimeAsync(500);
    expect(wake.state()).toBe("awake");
    expect(onAwake).not.toHaveBeenCalled();
  });

  it("no avisa si termina sin red (de despertando a offline)", async () => {
    const { wake } = build([http(503)]);
    const onAwake = vi.fn();
    const { win, doc } = targets();
    watchWake(wake, win, doc, onAwake);
    await vi.advanceTimersByTimeAsync(WAKE_BUDGET_MS + WAKE_RETRY_MS);
    expect(wake.state()).toBe("offline");
    expect(onAwake).not.toHaveBeenCalled();
  });
});
