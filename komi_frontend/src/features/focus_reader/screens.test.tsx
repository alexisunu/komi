import { afterEach, describe, expect, it, vi } from "vitest";
import type { LocalBook } from "../../data/local_db/types";
import type { FocusSnapshot } from "../../services/focusVisibilityService";
import type { WakeLockService } from "../../services/wakeLockService";
import { click, render } from "../../test/render";
import { formatClock } from "./clockFormat";
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

function timer(over: { snapshot?: FocusSnapshot; early?: { actualSec: number; belowHalf: boolean } | null } = {}) {
  const lock = wakeLock();
  const onAcceptEarly = vi.fn();
  const onCancel = vi.fn();
  const peek = vi.fn(() => (over.early === undefined ? { actualSec: 600, belowHalf: false } : over.early));
  mounted = render(
    <PhysicalTimerScreen
      book={BOOK}
      snapshot={over.snapshot ?? snap()}
      wakeLock={lock}
      peekEarlyFinish={peek}
      onAcceptEarly={onAcceptEarly}
      onCancel={onCancel}
    />,
  );
  return { root: mounted.container, lock, onAcceptEarly, onCancel, peek };
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
        peekEarlyFinish={() => null}
        onAcceptEarly={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(root.querySelector(".sunflower--breathing-paused")).not.toBeNull();
    expect(root.querySelector(".grace-banner")?.textContent).toContain("10 s");
  });

  it("con el 50 % o mas, Terminé antes de tiempo acepta sin preguntar", () => {
    const { root, onAcceptEarly, onCancel } = timer({ early: { actualSec: 450, belowHalf: false } });
    click(button(root, "Terminé antes de tiempo"));
    expect(onAcceptEarly).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("con menos del 50 % abre la confirmacion y no cancela hasta confirmar", () => {
    const { onAcceptEarly, onCancel, root } = timer({ early: { actualSec: 449, belowHalf: true } });
    click(button(root, "Terminé antes de tiempo"));
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("no se guarda ningún avance");
    expect(onAcceptEarly).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
    click(button(document.body, "Cancelar sesión"));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onAcceptEarly).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("Seguir leyendo cierra la hoja sin cancelar ni aceptar", () => {
    const { onAcceptEarly, onCancel, root } = timer({ early: { actualSec: 10, belowHalf: true } });
    click(button(root, "Terminé antes de tiempo"));
    click(button(document.body, "Seguir leyendo"));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(onAcceptEarly).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("solo usa tokens de color y no mueve nada que no sea decorativo", () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\brgba?\(|\bhsla?\(/);
    expect(css).not.toContain("animation");
  });
});
