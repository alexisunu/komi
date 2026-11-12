import { describe, expect, it } from "vitest";
import {
  applyFinal,
  applyHidden,
  peekFinish,
  elapsedMs,
  evaluate,
  foregroundSec,
  GRACE_MS,
  heartbeatDue,
  parseActiveSession,
  remainingMs,
  type ActiveSession,
} from "./focusSessionMachine";

const T0 = 1_800_000_000_000;
const PLANNED = 600; // 10 min

function session(over: Partial<ActiveSession> = {}): ActiveSession {
  return {
    sessionId: "s",
    bookId: "b",
    plannedSec: PLANNED,
    startedAt: T0,
    startedAtLocal: "2026-11-05T10:00:00",
    hiddenAt: null,
    lastSeen: T0,
    finalSec: null,
    ...over,
  };
}

describe("tiempo desde marcas", () => {
  it("el restante sale de now - startedAt, sin contar ticks", () => {
    expect(remainingMs(session(), T0 + 125_000)).toBe(475_000);
    expect(elapsedMs(session(), T0 + 125_000)).toBe(125_000);
  });

  it("un salto de minutos entre dos lecturas se refleja entero", () => {
    expect(remainingMs(session(), T0 + 9 * 60_000)).toBe(60_000);
  });

  it("nunca pasa de lo programado ni baja de cero", () => {
    expect(remainingMs(session(), T0 + 99 * 60_000)).toBe(0);
    expect(elapsedMs(session(), T0 + 99 * 60_000)).toBe(PLANNED * 1000);
  });

  it("un reloj que retrocede nunca da un tiempo negativo", () => {
    expect(elapsedMs(session(), T0 - 60_000)).toBe(0);
    expect(remainingMs(session(), T0 - 60_000)).toBe(PLANNED * 1000);
    expect(foregroundSec(session(), T0 - 60_000)).toBe(0);
  });
});

describe("gracia por salida (FA-3.1, FA-3.2)", () => {
  const hiddenAt = T0 + 60_000;
  const away = (ms: number, visible = true) =>
    evaluate(session({ hiddenAt, lastSeen: hiddenAt }), hiddenAt + ms, { visible });

  it("14 999 ms fuera: la sesion continua", () => {
    expect(away(GRACE_MS - 1)).toEqual({ kind: "running" });
  });

  it("exactamente 15 000 ms fuera (el borde): sigue valida", () => {
    expect(away(GRACE_MS)).toEqual({ kind: "running" });
  });

  it("15 001 ms fuera: se invalida con el tiempo en primer plano hasta la salida", () => {
    expect(away(GRACE_MS + 1)).toEqual({ kind: "invalidated", actualSec: 60 });
  });

  it("mientras esta oculta: grace con lo que queda, y a los 15 001 ms ya invalida", () => {
    expect(away(4_000, false)).toEqual({ kind: "grace", graceRemainingMs: 11_000 });
    expect(away(GRACE_MS, false)).toEqual({ kind: "grace", graceRemainingMs: 0 });
    expect(away(GRACE_MS + 1, false).kind).toBe("invalidated");
  });

  it("un reloj que retrocede durante la salida no invalida", () => {
    const a = session({ hiddenAt, lastSeen: hiddenAt });
    expect(evaluate(a, hiddenAt - 90_000, { visible: true })).toEqual({ kind: "running" });
  });

  it("el tiempo fuera cuenta como lectura: el restante ya lo descuenta", () => {
    expect(remainingMs(session(), hiddenAt + 10_000)).toBe((PLANNED - 70) * 1000);
  });
});

describe("vencimiento mientras la pagina esta oculta: primero la gracia", () => {
  const hiddenAt = T0 + (PLANNED - 5) * 1000; // sale a 5 s del final

  it("vuelve a los 10 s: el plazo vencio dentro de la gracia, se completa", () => {
    const a = session({ hiddenAt, lastSeen: hiddenAt });
    expect(evaluate(a, hiddenAt + 10_000, { visible: true })).toEqual({
      kind: "completed",
      actualSec: PLANNED,
    });
  });

  it("vuelve a los 20 s: aunque el plazo vencio, se invalida (con lo leido hasta salir)", () => {
    const a = session({ hiddenAt, lastSeen: hiddenAt });
    expect(evaluate(a, hiddenAt + 20_000, { visible: true })).toEqual({
      kind: "invalidated",
      actualSec: PLANNED - 5,
    });
  });
});

describe("reapertura sin evento hidden (cierre forzado)", () => {
  it("usa lastSeen: mas de 15 s sin verse invalida con los segundos hasta lastSeen", () => {
    const a = session({ lastSeen: T0 + 100_000 });
    expect(evaluate(a, T0 + 100_000 + GRACE_MS + 1, { visible: true, reopened: true })).toEqual({
      kind: "invalidated",
      actualSec: 100,
    });
  });

  it("exactamente 15 000 ms desde lastSeen: se retoma", () => {
    const a = session({ lastSeen: T0 + 100_000 });
    expect(evaluate(a, T0 + 100_000 + GRACE_MS, { visible: true, reopened: true })).toEqual({
      kind: "running",
    });
  });

  it("sin reopened, lastSeen no se usa (la pagina esta viva)", () => {
    const a = session({ lastSeen: T0 });
    expect(evaluate(a, T0 + 120_000, { visible: true })).toEqual({ kind: "running" });
  });

  it("con hiddenAt manda hiddenAt, no lastSeen", () => {
    const a = session({ hiddenAt: T0 + 50_000, lastSeen: T0 });
    expect(evaluate(a, T0 + 60_000, { visible: true, reopened: true })).toEqual({ kind: "running" });
  });
});

describe("estado final guardado", () => {
  it("una sesion terminada vuelve igual tras la reapertura, pase el tiempo que pase", () => {
    const done = applyFinal(session(), 400);
    expect(evaluate(done, T0 + 9_999_999, { visible: true, reopened: true })).toEqual({
      kind: "early",
      actualSec: 400,
    });
    expect(evaluate(applyFinal(session(), PLANNED), T0 + 9_999_999, { visible: true })).toEqual({
      kind: "completed",
      actualSec: PLANNED,
    });
  });

  it("applyHidden no pisa una salida ya empezada: la gracia no se reinicia", () => {
    const first = applyHidden(session(), T0 + 1_000);
    expect(applyHidden(first, T0 + 9_000).hiddenAt).toBe(T0 + 1_000);
  });
});

describe("Terminar sesion (FA-3.3, regla unica)", () => {
  it("5:00 exactos bastan; un segundo menos no", () => {
    expect(peekFinish(session(), T0 + 300_000)).toEqual({ actualSec: 300, enough: true });
    expect(peekFinish(session(), T0 + 299_000)).toEqual({ actualSec: 299, enough: false });
  });

  it("los segundos se truncan hacia abajo: 4:59.9 todavia no es 5:00", () => {
    expect(peekFinish(session(), T0 + 299_999)).toEqual({ actualSec: 299, enough: false });
  });

  it("ya no depende del tiempo programado: 5 minutos de un temporizador largo bastan", () => {
    const hour = { ...session(), plannedSec: 3600 };
    expect(peekFinish(hour, T0 + 300_000).enough).toBe(true);
  });

  it("no supera lo programado ni baja de cero con el reloj atras", () => {
    expect(peekFinish(session(), T0 + 99 * 60_000).actualSec).toBe(PLANNED);
    expect(peekFinish(session(), T0 - 5_000).actualSec).toBe(0);
  });
});

describe("latido y lectura del registro", () => {
  it("toca cada 5 s, o de inmediato si el reloj retrocedio", () => {
    expect(heartbeatDue(T0, T0 + 4_999)).toBe(false);
    expect(heartbeatDue(T0, T0 + 5_000)).toBe(true);
    expect(heartbeatDue(T0, T0 - 1)).toBe(true);
  });

  it("ida y vuelta por JSON; lo invalido se descarta", () => {
    const a = session({ hiddenAt: T0 + 1, finalSec: 5 });
    expect(parseActiveSession(JSON.stringify(a))).toEqual(a);
    expect(parseActiveSession("{no es json")).toBeNull();
    expect(parseActiveSession(null)).toBeNull();
    expect(parseActiveSession(JSON.stringify({ ...a, plannedSec: "10" }))).toBeNull();
    expect(parseActiveSession(JSON.stringify({ ...a, plannedSec: 0 }))).toBeNull();
    expect(parseActiveSession(JSON.stringify({ ...a, hiddenAt: "x" }))).toBeNull();
  });
});
