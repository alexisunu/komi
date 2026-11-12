import { afterEach, describe, expect, it, vi } from "vitest";
import type { LocalBook } from "../../data/local_db/types";
import type { FocusSnapshot } from "../../services/focusVisibilityService";
import type { WakeLockService } from "../../services/wakeLockService";
import { click, render } from "../../test/render";
import { formatClock, formatElapsed, sessionClock, sessionSubtitle } from "./clockFormat";
import css from "./PhysicalTimerScreen.css?raw";
import { PhysicalTimerScreen } from "./PhysicalTimerScreen";

let mounted: ReturnType<typeof render> | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
});

const BOOK: LocalBook = {
  id: "b",
  title: "Kokoro",
  author: "Natsume Soseki",
  format_type: "PHYSICAL",
  sunflower_variant: "CLASSIC",
  status: "ACTIVE",
  total_pages: 264,
  current_page: 87,
  progress_percentage: 32.95,
  last_epub_cfi: null,
  created_at: "2026-11-01T00:00:00.000Z",
  completed_at: null,
  updated_at: "2026-11-01T00:00:00.000Z",
  pending_sync: 0,
};

function snap(over: Partial<FocusSnapshot> = {}): FocusSnapshot {
  return {
    phase: "running",
    remainingMs: 754_200,
    elapsedMs: 145_800,
    plannedSec: 900,
    timerType: "TIMER",
    graceRemainingMs: 0,
    actualSec: null,
    sessionId: "s",
    bookId: "b",
    ...over,
  };
}

function wakeLock() {
  return { acquire: vi.fn(async () => {}), release: vi.fn(async () => {}) } as unknown as WakeLockService & {
    acquire: ReturnType<typeof vi.fn>;
    release: ReturnType<typeof vi.fn>;
  };
}

function timer(over: { snapshot?: FocusSnapshot; early?: { actualSec: number; enough: boolean } | null } = {}) {
  const lock = wakeLock();
  const onFinish = vi.fn();
  const onCancel = vi.fn();
  const peek = vi.fn(() => (over.early === undefined ? { actualSec: 600, enough: true } : over.early));
  mounted = render(
    <PhysicalTimerScreen
      book={BOOK}
      snapshot={over.snapshot ?? snap()}
      wakeLock={lock}
      peekFinish={peek}
      onFinish={onFinish}
      onCancel={onCancel}
    />,
  );
  return { root: mounted.container, lock, onFinish, onCancel, peek };
}

const button = (root: ParentNode, text: string) =>
  [...root.querySelectorAll("button")].find((b) => b.textContent?.trim() === text);

describe("formatClock", () => {
  it("redondea hacia arriba y rellena con ceros", () => {
    expect(formatClock(900_000)).toBe("15:00");
    expect(formatClock(754_200)).toBe("12:35");
    expect(formatClock(1)).toBe("00:01");
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(7_200_000)).toBe("120:00");
    expect(formatClock(-5_000)).toBe("00:00");
  });
});

describe("formatElapsed (cronometro del modo libre)", () => {
  it("empieza en 00:00 y trunca: los segundos ya cumplidos", () => {
    expect(formatElapsed(0)).toBe("00:00");
    expect(formatElapsed(999)).toBe("00:00");
    expect(formatElapsed(1_000)).toBe("00:01");
    expect(formatElapsed(59_999)).toBe("00:59");
    expect(formatElapsed(60_000)).toBe("01:00");
    expect(formatElapsed(299_000)).toBe("04:59");
    expect(formatElapsed(3_599_000)).toBe("59:59");
  });

  it("pasada la hora usa h:mm:ss", () => {
    expect(formatElapsed(3_600_000)).toBe("1:00:00");
    expect(formatElapsed(3_661_000)).toBe("1:01:01");
    expect(formatElapsed(7_200_000)).toBe("2:00:00");
  });

  it("nunca es negativo", () => {
    expect(formatElapsed(-5_000)).toBe("00:00");
  });

  it("sessionClock elige el restante o el transcurrido segun el modo", () => {
    const base = { remainingMs: 754_200, elapsedMs: 145_800 };
    expect(sessionClock({ ...base, timerType: "TIMER" })).toBe("12:35");
    expect(sessionClock({ ...base, timerType: "FREE" })).toBe("02:25");
  });

  it("sessionSubtitle: Modo libre o Temporizador, con el avance si se conoce", () => {
    expect(sessionSubtitle("FREE", 12.9)).toBe("Modo libre · 12 %");
    expect(sessionSubtitle("TIMER", 40)).toBe("Temporizador · 40 %");
    expect(sessionSubtitle("FREE", null)).toBe("Modo libre");
    expect(sessionSubtitle("TIMER", null)).toBe("Temporizador");
  });
});

describe("PhysicalTimerScreen", () => {
  it("muestra el titulo, el reloj y una sola accion, en 3 bloques", () => {
    const { root } = timer();
    expect(root.querySelector("h1")?.textContent).toBe("Kokoro");
    expect(root.querySelector("[role=timer]")?.textContent).toBe("12:35");
    expect(root.querySelectorAll("[data-block]")).toHaveLength(3);
    expect(root.querySelectorAll("button")).toHaveLength(1);
    expect(root.querySelector(".bottom-nav")).toBeNull();
  });

  it("pide la pantalla encendida al montar y la libera al desmontar", () => {
    const { lock } = timer();
    expect(lock.acquire).toHaveBeenCalledTimes(1);
    expect(lock.release).not.toHaveBeenCalled();
    mounted?.unmount();
    mounted = null;
    expect(lock.release).toHaveBeenCalledTimes(1);
  });

  it("el girasol respira, y en gracia se pausa y aparece el aviso", () => {
    const { root } = timer();
    expect(root.querySelector(".sunflower--breathing")).not.toBeNull();
    expect(root.querySelector(".sunflower--breathing-paused")).toBeNull();
    expect(root.querySelector(".grace-banner")).toBeNull();
    mounted?.rerender(
      <PhysicalTimerScreen
        book={BOOK}
        snapshot={snap({ phase: "grace", graceRemainingMs: 9_100 })}
        wakeLock={wakeLock()}
        peekFinish={() => null}
        onFinish={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(root.querySelector(".sunflower--breathing-paused")).not.toBeNull();
    expect(root.querySelector(".grace-banner")?.textContent).toContain("10 s");
  });

  it("en temporizador muestra Temporizador · N % y el reloj de lo que resta", () => {
    const { root } = timer();
    expect(root.querySelector(".focus-timer__mode")?.textContent).toBe("Temporizador · 32 %");
    expect(root.querySelector("[role=timer]")?.getAttribute("aria-label")).toBe("Tiempo restante");
  });

  describe("modo libre", () => {
    const FREE = snap({ timerType: "FREE", plannedSec: 7200, elapsedMs: 3_725_000, remainingMs: 3_475_000 });

    it("el reloj cuenta hacia arriba con h:mm:ss y el subtitulo dice Modo libre", () => {
      const { root } = timer({ snapshot: FREE });
      expect(root.querySelector("[role=timer]")?.textContent).toBe("1:02:05");
      expect(root.querySelector("[role=timer]")?.getAttribute("aria-label")).toBe("Tiempo leído");
      expect(root.querySelector(".focus-timer__mode")?.textContent).toBe("Modo libre · 32 %");
      expect(root.querySelector("[role=timer]")?.className).toContain("tabular");
    });

    it("bajo la hora usa mm:ss", () => {
      const { root } = timer({ snapshot: snap({ timerType: "FREE", elapsedMs: 145_800 }) });
      expect(root.querySelector("[role=timer]")?.textContent).toBe("02:25");
    });

    it("el aviso, Seguir leyendo, Descartar y Terminé el libro funcionan igual", () => {
      const a = timer({ snapshot: FREE, early: { actualSec: 299, enough: false } });
      click(button(a.root, "Terminar sesión"));
      expect(document.querySelector('[role="dialog"]')?.textContent).toContain("El tiempo mínimo es 5 min");
      click(button(document.body, "Seguir leyendo"));
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      click(button(a.root, "Terminar sesión"));
      click(button(document.body, "Descartar"));
      expect(a.onCancel).toHaveBeenCalledTimes(1);
      expect(a.onFinish).not.toHaveBeenCalled();
      click(button(a.root, "Terminar sesión"));
      click(button(document.body, "Terminé el libro"));
      expect(a.onFinish).toHaveBeenCalledTimes(1);
    });

    it("con 5 minutos o mas termina directo", () => {
      const { root, onFinish } = timer({ snapshot: FREE, early: { actualSec: 300, enough: true } });
      click(button(root, "Terminar sesión"));
      expect(onFinish).toHaveBeenCalledTimes(1);
      expect(document.querySelector('[role="dialog"]')).toBeNull();
    });
  });

  it("Terminar sesion con 5 minutos o mas termina directo, sin confirmacion", () => {
    const { root, onFinish, onCancel } = timer({ early: { actualSec: 300, enough: true } });
    click(button(root, "Terminar sesión"));
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("ya no existe el boton Terminé antes de tiempo", () => {
    const { root } = timer();
    expect(button(root, "Terminé antes de tiempo")).toBeUndefined();
    expect(button(root, "Terminar sesión")).toBeDefined();
  });

  describe("aviso de menos de 5 minutos", () => {
    const SHORT = { early: { actualSec: 299, enough: false } };
    const dialog = () => document.querySelector('[role="dialog"]');

    it("aparece con el motivo claro y no termina ni descarta nada", () => {
      const { onFinish, onCancel, root } = timer(SHORT);
      click(button(root, "Terminar sesión"));
      expect(dialog()?.textContent).toContain("El tiempo mínimo es 5 min");
      expect(dialog()?.textContent).not.toContain("mitad");
      expect(onFinish).not.toHaveBeenCalled();
      expect(onCancel).not.toHaveBeenCalled();
    });

    it("Seguir leyendo es la accion principal, Descartar la secundaria, y no hay Cancelar sesion", () => {
      const { root } = timer(SHORT);
      click(button(root, "Terminar sesión"));
      expect((button(document.body, "Seguir leyendo") as HTMLButtonElement).className).not.toContain("secondary");
      expect((button(document.body, "Descartar") as HTMLButtonElement).className).toContain("secondary");
      expect(button(document.body, "Cancelar sesión")).toBeUndefined();
    });

    it("Seguir leyendo cierra la hoja sin descartar ni terminar", () => {
      const { onFinish, onCancel, root } = timer(SHORT);
      click(button(root, "Terminar sesión"));
      click(button(document.body, "Seguir leyendo"));
      expect(dialog()).toBeNull();
      expect(onFinish).not.toHaveBeenCalled();
      expect(onCancel).not.toHaveBeenCalled();
    });

    it("Descartar sale sin guardar nada: onCancel una vez, onFinish nunca", () => {
      const { onFinish, onCancel, root } = timer(SHORT);
      click(button(root, "Terminar sesión"));
      click(button(document.body, "Descartar"));
      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(onFinish).not.toHaveBeenCalled();
      expect(dialog()).toBeNull();
    });

    it("aunque pasen los 5 minutos con el aviso abierto, Descartar no guarda", () => {
      const ctx = timer(SHORT);
      click(button(ctx.root, "Terminar sesión"));
      ctx.peek.mockReturnValue({ actualSec: 301, enough: true });
      click(button(document.body, "Descartar"));
      expect(ctx.onCancel).toHaveBeenCalledTimes(1);
      expect(ctx.onFinish).not.toHaveBeenCalled();
    });

    it("Terminé el libro (solo libro fisico) cierra el aviso y deja que la hoja de cierre pida la ultima pagina", () => {
      const { onFinish, onCancel, root } = timer(SHORT);
      click(button(root, "Terminar sesión"));
      click(button(document.body, "Terminé el libro"));
      expect(onFinish).toHaveBeenCalledTimes(1);
      expect(onCancel).not.toHaveBeenCalled();
      expect(dialog()).toBeNull();
    });
  });

  it("solo usa tokens de color y no mueve nada que no sea decorativo", () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\brgba?\(|\bhsla?\(/);
    expect(css).not.toContain("animation");
  });
});
