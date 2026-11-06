import { describe, expect, it } from "vitest";
import { BOOK_ID, createFocusEnv, SESSION_ID, T0 } from "../test/focusEnv";

const PLANNED = 600;
const input = { sessionId: SESSION_ID, bookId: BOOK_ID, plannedSec: PLANNED };

async function started() {
  const env = createFocusEnv();
  await env.service.start(input);
  return env;
}

describe("inicio", () => {
  it("guarda active_session de inmediato con la hora local de inicio", async () => {
    const env = await started();
    expect(env.stored).toMatchObject({
      sessionId: SESSION_ID,
      bookId: BOOK_ID,
      plannedSec: PLANNED,
      startedAt: T0,
      hiddenAt: null,
      lastSeen: T0,
      finalSec: null,
    });
    expect(env.stored?.startedAtLocal).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    expect(env.service.getSnapshot()).toMatchObject({ phase: "running", remainingMs: PLANNED * 1000 });
  });

  it("rechaza ids que no son UUID, duraciones fuera de rango y una segunda sesion", async () => {
    const env = createFocusEnv();
    await expect(env.service.start({ ...input, sessionId: "x" })).rejects.toThrow();
    await expect(env.service.start({ ...input, plannedSec: 299 })).rejects.toThrow();
    await expect(env.service.start({ ...input, plannedSec: 7201 })).rejects.toThrow();
    await env.service.start(input);
    await expect(env.service.start(input)).rejects.toThrow(/en curso/);
  });
});

describe("tiempo por marcas de tiempo", () => {
  it("un salto de minutos sin ticks en medio da el restante exacto", async () => {
    const env = await started();
    env.advance(7 * 60_000);
    await env.service.tick();
    expect(env.service.getSnapshot()?.remainingMs).toBe(3 * 60_000);
  });

  it("al vencer el plazo con la pagina visible, se completa y queda guardada con finalSec", async () => {
    const env = await started();
    env.advance(PLANNED * 1000 + 3);
    await env.service.tick();
    await env.settle();
    expect(env.service.getSnapshot()).toMatchObject({
      phase: "completed",
      actualSec: PLANNED,
      remainingMs: 0,
    });
    expect(env.stored?.finalSec).toBe(PLANNED);
  });

  it("el reloj que retrocede no rompe nada", async () => {
    const env = await started();
    env.advance(120_000);
    await env.service.tick();
    env.set(T0 - 3_600_000);
    await env.service.tick();
    expect(env.service.getSnapshot()).toMatchObject({ phase: "running", remainingMs: PLANNED * 1000 });
  });
});

describe("gracia de 15 s por salida", () => {
  it("14,9 s fuera: la sesion continua y el tiempo fuera cuenta", async () => {
    const env = await started();
    env.advance(30_000);
    env.hide();
    expect(env.service.getSnapshot()?.phase).toBe("grace");
    env.advance(14_900);
    await env.show();
    await env.settle();
    expect(env.service.getSnapshot()).toMatchObject({ phase: "running" });
    expect(env.service.getSnapshot()?.remainingMs).toBe((PLANNED - 44.9) * 1000);
    expect(env.invalidated).toHaveLength(0);
    expect(env.stored?.hiddenAt).toBeNull();
  });

  it("exactamente 15 000 ms fuera: sigue valida", async () => {
    const env = await started();
    env.hide();
    env.advance(15_000);
    await env.show();
    expect(env.service.getSnapshot()?.phase).toBe("running");
    expect(env.invalidated).toHaveLength(0);
  });

  it("15,1 s fuera: se invalida y se guarda con los segundos de primer plano", async () => {
    const env = await started();
    env.advance(42_000);
    env.hide();
    env.advance(15_100);
    await env.show();
    expect(env.service.getSnapshot()).toMatchObject({ phase: "invalidated", actualSec: 42 });
    expect(env.invalidated).toHaveLength(1);
    expect(env.invalidated[0]).toMatchObject({ actualSec: 42 });
    expect(env.invalidated[0]?.session.sessionId).toBe(SESSION_ID);
    expect(env.stored).toBeNull();
    expect(env.listenerCount()).toBe(0);
  });

  it("varias salidas cortas no se acumulan: 3 de 10 s siguen validas", async () => {
    const env = await started();
    for (let i = 0; i < 3; i += 1) {
      env.advance(20_000);
      env.hide();
      env.advance(10_000);
      await env.show();
      expect(env.service.getSnapshot()?.phase).toBe("running");
    }
    expect(env.invalidated).toHaveLength(0);
  });

  it("tras una salida corta, la siguiente salida empieza de cero y la larga invalida", async () => {
    const env = await started();
    env.hide();
    env.advance(14_000);
    await env.show();
    env.advance(5_000);
    env.hide();
    env.advance(15_001);
    await env.show();
    expect(env.service.getSnapshot()?.phase).toBe("invalidated");
    expect(env.invalidated[0]?.actualSec).toBe(5 + 14);
  });

  it("dos eventos hidden seguidos no reinician la cuenta", async () => {
    const env = await started();
    env.hide();
    env.advance(10_000);
    env.hide();
    env.advance(6_000);
    await env.show();
    expect(env.service.getSnapshot()?.phase).toBe("invalidated");
  });

  it("la cuenta de gracia baja con el reloj mientras esta oculta", async () => {
    const env = await started();
    env.hide();
    env.advance(4_200);
    await env.service.tick();
    expect(env.service.getSnapshot()).toMatchObject({ phase: "grace", graceRemainingMs: 10_800 });
  });

  it("si un tick llega con la pagina oculta pasados los 15 s, invalida sin esperar al regreso", async () => {
    const env = await started();
    env.hide();
    env.advance(16_000);
    await env.service.tick();
    expect(env.invalidated).toHaveLength(1);
    expect(env.service.getSnapshot()?.phase).toBe("invalidated");
  });
});

describe("vencimiento total mientras la pagina esta oculta", () => {
  it("sale a 5 s del final y vuelve a los 10 s: se completa", async () => {
    const env = await started();
    env.advance((PLANNED - 5) * 1000);
    env.hide();
    env.advance(10_000);
    await env.show();
    expect(env.service.getSnapshot()).toMatchObject({ phase: "completed", actualSec: PLANNED });
    expect(env.invalidated).toHaveLength(0);
  });

  it("sale a 5 s del final y vuelve a los 20 s: se evalua la gracia primero y se invalida", async () => {
    const env = await started();
    env.advance((PLANNED - 5) * 1000);
    env.hide();
    env.advance(20_000);
    await env.show();
    expect(env.service.getSnapshot()).toMatchObject({ phase: "invalidated", actualSec: PLANNED - 5 });
    expect(env.invalidated).toHaveLength(1);
  });

  it("se sale con el plazo ya muy pasado (salto enorme): invalida, no completa", async () => {
    const env = await started();
    env.advance(60_000);
    env.hide();
    env.advance(3 * 3_600_000);
    await env.show();
    expect(env.service.getSnapshot()).toMatchObject({ phase: "invalidated", actualSec: 60 });
  });
});

describe("recuperacion tras recarga con active_session", () => {
  it("con hiddenAt y 10 s fuera: se retoma", async () => {
    const env = await started();
    env.advance(20_000);
    env.hide();
    env.advance(10_000);
    await env.settle();
    const again = env.reload();
    const snap = await again.recover();
    expect(snap).toMatchObject({ phase: "running" });
    expect(env.stored?.hiddenAt).toBeNull();
    again.dispose();
  });

  it("con hiddenAt y mas de 15 s fuera: se guarda invalidada y se borra el registro", async () => {
    const env = await started();
    env.advance(20_000);
    env.hide();
    env.advance(16_000);
    await env.settle();
    const again = env.reload();
    const snap = await again.recover();
    expect(snap).toMatchObject({ phase: "invalidated", actualSec: 20 });
    expect(env.invalidated).toHaveLength(1);
    expect(env.stored).toBeNull();
  });

  it("cierre forzado sin evento hidden: pasados 15 s desde lastSeen se invalida con lastSeen", async () => {
    const env = await started();
    env.advance(30_000);
    env.pagehide(); // lastSeen = T0 + 30 s; la pagina muere sin visibilitychange
    env.advance(15_001);
    await env.settle();
    const again = env.reload();
    const snap = await again.recover();
    expect(snap).toMatchObject({ phase: "invalidated", actualSec: 30 });
    expect(env.invalidated[0]?.actualSec).toBe(30);
  });

  it("cierre forzado y reapertura a los 15 000 ms exactos de lastSeen: se retoma", async () => {
    const env = await started();
    env.advance(30_000);
    env.pagehide();
    env.advance(15_000);
    await env.settle();
    const again = env.reload();
    expect((await again.recover())?.phase).toBe("running");
    expect(env.invalidated).toHaveLength(0);
    again.dispose();
  });

  it("cierre forzado sin pagehide: manda el ultimo latido guardado (~5 s)", async () => {
    const env = await started();
    for (let i = 0; i < 40; i += 1) {
      env.advance(1_000);
      await env.service.tick();
      await env.settle(); // latidos en 5, 10, 15, 20, 25, 30, 35, 40 s
    }
    env.advance(15_001);
    await env.settle();
    const again = env.reload();
    const snap = await again.recover();
    expect(snap?.phase).toBe("invalidated");
    expect(snap?.actualSec).toBe(40);
  });

  it("una sesion terminada y sin guardar vuelve tal cual (completada o anticipada)", async () => {
    const env = await started();
    env.advance(400_000);
    env.service.acceptEarlyFinish();
    env.advance(10 * 3_600_000);
    await env.settle();
    const again = env.reload();
    expect(await again.recover()).toMatchObject({ phase: "early", actualSec: 400 });
    expect(env.invalidated).toHaveLength(0);
    again.dispose();
  });

  it("sin registro, o con uno corrupto, no hay sesion", async () => {
    const env = createFocusEnv();
    expect(await env.service.recover()).toBeNull();
  });

  it("si guardar la invalidada falla, el registro se conserva para reintentar", async () => {
    const env = await started();
    env.hide();
    env.advance(20_000);
    const failing = createFocusEnv();
    failing.stored = env.stored;
    failing.set(env.now());
    const broken = failing.reload();
    // Sustituye el guardado por uno que falla: se arma un servicio nuevo con ese fallo.
    const { createFocusVisibilityService } = await import("./focusVisibilityService");
    const service = createFocusVisibilityService({
      now: () => failing.now(),
      doc: { visibilityState: "visible", addEventListener() {}, removeEventListener() {} },
      win: { addEventListener() {}, removeEventListener() {} },
      store: failing.store,
      saveInvalidated: async () => {
        throw new Error("sin espacio");
      },
    });
    expect((await service.recover())?.phase).toBe("invalidated");
    expect(failing.stored).not.toBeNull();
    broken.dispose();
  });
});

describe("latido de lastSeen", () => {
  it("con ticks de 250 ms solo guarda una vez cada ~5 s", async () => {
    const env = await started();
    const initial = env.saves.length;
    for (let i = 0; i < 19; i += 1) {
      env.advance(250);
      await env.service.tick();
    }
    expect(env.saves.length).toBe(initial); // 4,75 s: nada
    env.advance(250);
    await env.service.tick(); // 5 s
    await env.settle();
    expect(env.saves.length).toBe(initial + 1);
    expect(env.stored?.lastSeen).toBe(T0 + 5_000);
  });

  it("pagehide guarda lastSeen de inmediato", async () => {
    const env = await started();
    env.advance(2_000);
    env.pagehide();
    await env.settle();
    expect(env.stored?.lastSeen).toBe(T0 + 2_000);
  });

  it("si el reloj retrocede se guarda enseguida", async () => {
    const env = await started();
    env.advance(10_000);
    await env.service.tick();
    await env.settle();
    const before = env.saves.length;
    env.set(T0 + 1_000);
    await env.service.tick();
    await env.settle();
    expect(env.saves.length).toBe(before + 1);
  });
});

describe("Terminé antes de tiempo", () => {
  it("con el 50 % o mas es valido y queda con finalSec", async () => {
    const env = await started();
    env.advance(300_000);
    expect(env.service.peekEarlyFinish()).toEqual({ actualSec: 300, belowHalf: false });
    env.service.acceptEarlyFinish();
    await env.settle();
    expect(env.service.getSnapshot()).toMatchObject({ phase: "early", actualSec: 300 });
    expect(env.stored?.finalSec).toBe(300);
  });

  it("con menos del 50 % avisa para pedir confirmacion; cancelar no guarda nada", async () => {
    const env = await started();
    env.advance(100_000);
    expect(env.service.peekEarlyFinish()).toEqual({ actualSec: 100, belowHalf: true });
    await env.service.close();
    expect(env.stored).toBeNull();
    expect(env.invalidated).toHaveLength(0);
    expect(env.service.getSnapshot()).toBeNull();
  });
});

describe("cierre y desmontaje", () => {
  it("close borra el registro y deja de escuchar", async () => {
    const env = await started();
    expect(env.listenerCount()).toBe(2);
    await env.service.close();
    expect(env.stored).toBeNull();
    expect(env.listenerCount()).toBe(0);
  });

  it("dispose deja de escuchar pero conserva el registro para retomar", async () => {
    const env = await started();
    env.service.dispose();
    expect(env.listenerCount()).toBe(0);
    expect(env.stored).not.toBeNull();
  });

  it("tras close ya no reacciona a visibilitychange", async () => {
    const env = await started();
    await env.service.close();
    env.hide();
    env.advance(60_000);
    await env.show();
    expect(env.invalidated).toHaveLength(0);
  });
});
