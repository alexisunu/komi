import { describe, expect, it, vi } from "vitest";
import { CHIME_NOTES, CHIME_PEAK_GAIN, createEndChimeService, type EndChimeEnv } from "./endChime";

// Web Audio no existe en jsdom: aqui se prueba la programacion con un contexto falso.

function fakeContext(over: { state?: string; resume?: () => Promise<void> } = {}) {
  const oscillators: Array<{
    type: string;
    frequency: { value: number };
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    connect: ReturnType<typeof vi.fn>;
  }> = [];
  const gains: Array<{ gain: Record<string, ReturnType<typeof vi.fn>>; connect: ReturnType<typeof vi.fn> }> = [];
  const sources: Array<{ start: ReturnType<typeof vi.fn>; connect: ReturnType<typeof vi.fn>; buffer: unknown }> = [];
  const instance = {
    state: over.state ?? "running",
    currentTime: 10,
    destination: { id: "destino" },
    resume: vi.fn(over.resume ?? (async () => {})),
    createBuffer: vi.fn(() => ({ id: "silencio" })),
    createBufferSource: vi.fn(() => {
      const source = { start: vi.fn(), connect: vi.fn(), buffer: null as unknown };
      sources.push(source);
      return source;
    }),
    createOscillator: vi.fn(() => {
      const oscillator = { type: "", frequency: { value: 0 }, start: vi.fn(), stop: vi.fn(), connect: vi.fn() };
      oscillators.push(oscillator);
      return oscillator;
    }),
    createGain: vi.fn(() => {
      const gain = {
        gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
        connect: vi.fn(),
      };
      gains.push(gain);
      return gain;
    }),
  };
  const created: unknown[] = [];
  const ctor = vi.fn(function () {
    created.push(instance);
    return instance;
  }) as unknown as EndChimeEnv["audioContext"];
  return { instance, ctor, oscillators, gains, sources, created };
}

function env(over: Partial<EndChimeEnv> = {}): EndChimeEnv {
  return { audioContext: undefined, navigator: {}, isVisible: () => true, ...over };
}

describe("endChime", () => {
  it("el volumen pico es una constante con nombre y moderada", () => {
    expect(CHIME_PEAK_GAIN).toBeGreaterThan(0);
    expect(CHIME_PEAK_GAIN).toBeLessThanOrEqual(0.5);
  });

  describe("unlock (dentro del gesto del usuario)", () => {
    it("fija audioSession.type = playback, crea el contexto, lo reanuda y reproduce un silencio", () => {
      const ctx = fakeContext();
      const nav = { audioSession: { type: "auto" } };
      createEndChimeService(env({ audioContext: ctx.ctor, navigator: nav })).unlock();
      expect(nav.audioSession.type).toBe("playback");
      expect(ctx.created).toHaveLength(1);
      expect(ctx.instance.resume).toHaveBeenCalledTimes(1);
      expect(ctx.sources).toHaveLength(1);
      expect(ctx.sources[0]?.start).toHaveBeenCalledWith(0);
      expect(ctx.sources[0]?.connect).toHaveBeenCalledWith(ctx.instance.destination);
    });

    it("es sincrono: todo ocurre antes de devolver el control (sin esperar a ninguna promesa)", () => {
      const ctx = fakeContext({ resume: () => new Promise<void>(() => {}) }); // resume nunca se resuelve
      createEndChimeService(env({ audioContext: ctx.ctor })).unlock();
      expect(ctx.instance.resume).toHaveBeenCalled();
      expect(ctx.sources[0]?.start).toHaveBeenCalled();
    });

    it("reutiliza el contexto: varios unlock no crean otro", () => {
      const ctx = fakeContext();
      const service = createEndChimeService(env({ audioContext: ctx.ctor }));
      service.unlock();
      service.unlock();
      expect(ctx.created).toHaveLength(1);
    });

    it("un contexto cerrado por el navegador se recrea en el siguiente unlock", () => {
      const ctx = fakeContext({ state: "closed" });
      const service = createEndChimeService(env({ audioContext: ctx.ctor }));
      service.unlock();
      service.unlock();
      expect(ctx.created).toHaveLength(2);
    });

    it("sin AudioContext ni audioSession no lanza", () => {
      expect(() => createEndChimeService(env()).unlock()).not.toThrow();
    });

    it("si el navegador rechaza resume() o audioSession, no lanza", () => {
      const ctx = fakeContext({ resume: async () => Promise.reject(new Error("bloqueado")) });
      const nav = {} as { audioSession?: { type: string } };
      Object.defineProperty(nav, "audioSession", {
        get: () => ({
          set type(_value: string) {
            throw new Error("solo lectura");
          },
        }),
      });
      expect(() => createEndChimeService(env({ audioContext: ctx.ctor, navigator: nav })).unlock()).not.toThrow();
    });

    it("si crear el contexto falla, no lanza y play devuelve false", () => {
      const ctor = vi.fn(function () {
        throw new Error("sin audio");
      }) as unknown as EndChimeEnv["audioContext"];
      const service = createEndChimeService(env({ audioContext: ctor }));
      expect(() => service.unlock()).not.toThrow();
      expect(service.play()).toBe(false);
    });
  });

  describe("play", () => {
    it("programa las dos notas con ataque corto, caida exponencial y el volumen pico", () => {
      const ctx = fakeContext();
      const service = createEndChimeService(env({ audioContext: ctx.ctor }));
      service.unlock();
      expect(service.play()).toBe(true);
      expect(ctx.oscillators.map((o) => o.frequency.value)).toEqual(CHIME_NOTES.map((n) => n.hz));
      expect(ctx.oscillators.every((o) => o.type === "sine")).toBe(true);
      const first = ctx.gains[0]?.gain;
      expect(first?.linearRampToValueAtTime).toHaveBeenCalledWith(CHIME_PEAK_GAIN, expect.any(Number));
      expect(first?.exponentialRampToValueAtTime).toHaveBeenCalledWith(expect.any(Number), expect.any(Number));
      // La segunda nota entra despues de la primera, desde el reloj del contexto.
      expect(ctx.oscillators[0]?.start).toHaveBeenCalledWith(10);
      expect(ctx.oscillators[1]?.start).toHaveBeenCalledWith(10 + (CHIME_NOTES[1]?.startS ?? 0));
      expect(ctx.oscillators.every((o) => o.stop.mock.calls.length === 1)).toBe(true);
    });

    it("sin unlock previo (por ejemplo, una sesion recuperada tras recargar) no suena", () => {
      const ctx = fakeContext();
      const service = createEndChimeService(env({ audioContext: ctx.ctor }));
      expect(service.play()).toBe(false);
      expect(ctx.oscillators).toHaveLength(0);
    });

    it("si el contexto sigue suspendido o interrumpido, no suena y no lanza", () => {
      for (const state of ["suspended", "interrupted", "closed"]) {
        const ctx = fakeContext({ state });
        const service = createEndChimeService(env({ audioContext: ctx.ctor }));
        service.unlock();
        expect(service.play()).toBe(false);
        expect(ctx.oscillators).toHaveLength(0);
      }
    });

    it("con la pagina oculta no suena", () => {
      const ctx = fakeContext();
      const service = createEndChimeService(env({ audioContext: ctx.ctor, isVisible: () => false }));
      service.unlock();
      expect(service.play()).toBe(false);
    });

    it("si programar una nota falla, devuelve false sin lanzar", () => {
      const ctx = fakeContext();
      ctx.instance.createOscillator.mockImplementation(() => {
        throw new Error("fallo");
      });
      const service = createEndChimeService(env({ audioContext: ctx.ctor }));
      service.unlock();
      expect(() => service.play()).not.toThrow();
      expect(service.play()).toBe(false);
    });
  });
});
