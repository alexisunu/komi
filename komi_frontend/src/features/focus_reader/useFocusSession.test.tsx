import { act, useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createReloadGate, type ReloadGate } from "../../pwa/reloadGate";
import type { ActiveSession } from "../../services/focusSessionMachine";
import { BOOK_ID, createFocusEnv, SESSION_ID, type FocusEnv } from "../../test/focusEnv";
import { render } from "../../test/render";
import { GracePeriodBanner } from "./GracePeriodBanner";
import { useFocusSession, type UseFocusSession } from "./useFocusSession";

const input = { sessionId: SESSION_ID, bookId: BOOK_ID, plannedSec: 600 };
const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));

const holder: { current: UseFocusSession | null } = { current: null };

function Probe({ env, gate, onSession }: { env: FocusEnv; gate: ReloadGate; onSession: (s: UseFocusSession) => void }) {
  const session = useFocusSession(env.service, gate);
  useEffect(() => {
    onSession(session);
  });
  return <span data-testid="phase">{session.snapshot?.phase ?? "none"}</span>;
}

function setup() {
  const env = createFocusEnv();
  const reload = vi.fn();
  const gate = createReloadGate(reload);
  const view = render(<Probe env={env} gate={gate} onSession={(s) => (holder.current = s)} />);
  return { env, gate, reload, view };
}

const hook = () => holder.current as UseFocusSession;

afterEach(() => {
  holder.current = null;
  document.body.innerHTML = "";
});

describe("useFocusSession y reloadGate", () => {
  it("bloquea la recarga al iniciar y una peticion durante la sesion no recarga", async () => {
    const { gate, reload, view } = setup();
    expect(gate.isBlocked()).toBe(false);
    await act(async () => hook().start(input));
    expect(gate.isBlocked()).toBe(true);
    gate.request();
    expect(reload).not.toHaveBeenCalled();
    view.unmount();
  });

  it("mantiene el bloqueo en gracia y al terminar, y recarga una sola vez al salir", async () => {
    const { env, gate, reload, view } = setup();
    await act(async () => hook().start(input));
    gate.request();

    act(() => env.hide());
    expect(gate.isBlocked()).toBe(true);
    env.advance(5_000);
    await act(async () => env.show());
    expect(gate.isBlocked()).toBe(true);

    env.advance(600_000);
    await act(async () => env.service.tick());
    expect(hook().snapshot?.phase).toBe("completed");
    expect(gate.isBlocked()).toBe(true); // la hoja post-lectura y el chat siguen protegidos
    expect(reload).not.toHaveBeenCalled();

    await act(async () => hook().leave());
    expect(gate.isBlocked()).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
    await act(async () => hook().leave()); // idempotente
    expect(reload).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it("con otro bloqueo anidado, no recarga hasta soltar ambos", async () => {
    const { gate, reload, view } = setup();
    const other = gate.block();
    await act(async () => hook().start(input));
    gate.request();
    await act(async () => hook().leave());
    expect(reload).not.toHaveBeenCalled();
    other();
    expect(reload).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it("al desmontar suelta el bloqueo y deja el registro para retomar", async () => {
    const { env, gate, reload, view } = setup();
    await act(async () => hook().start(input));
    gate.request();
    view.unmount();
    expect(gate.isBlocked()).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(env.stored).not.toBeNull();
    expect(env.listenerCount()).toBe(0);
  });

  it("si iniciar falla, no deja el bloqueo puesto", async () => {
    const { gate, view } = setup();
    await act(async () => {
      await hook()
        .start({ ...input, plannedSec: 10 })
        .catch(() => undefined);
    });
    expect(gate.isBlocked()).toBe(false);
    view.unmount();
  });

  it("al invalidarse la sesion suelta el bloqueo de recarga (ya quedo guardada)", async () => {
    const { env, gate, reload, view } = setup();
    await act(async () => hook().start(input));
    gate.request();
    act(() => env.hide());
    env.advance(16_000);
    await act(async () => env.show());
    await flush();
    expect(hook().snapshot?.phase).toBe("invalidated");
    expect(gate.isBlocked()).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it("descartar (leave) con menos de 5 minutos libera el bloqueo y no guarda sesion", async () => {
    const { env, gate, view } = setup();
    await act(async () => hook().start(input));
    env.advance(60_000);
    expect(hook().peekFinish()?.enough).toBe(false);
    await act(async () => hook().leave());
    expect(gate.isBlocked()).toBe(false);
    expect(env.invalidated).toHaveLength(0);
    expect(env.stored).toBeNull();
    view.unmount();
  });

  it("retoma una sesion guardada tras recargar y vuelve a bloquear", async () => {
    const first = setup();
    await act(async () => hook().start(input));
    await first.env.settle();
    const saved = first.env.stored as ActiveSession;
    first.view.unmount();

    const env = createFocusEnv();
    env.stored = saved;
    env.advance(8_000);
    const gate = createReloadGate(vi.fn());
    const view = render(<Probe env={env} gate={gate} onSession={(s) => (holder.current = s)} />);
    await flush();
    expect(hook().snapshot?.phase).toBe("running");
    expect(gate.isBlocked()).toBe(true);
    view.unmount();
    expect(gate.isBlocked()).toBe(false);
  });

  it("una sesion retomada pasados 15 s se invalida, no bloquea y avisa", async () => {
    const first = setup();
    await act(async () => hook().start(input));
    await first.env.settle();
    const stored = first.env.stored as ActiveSession;
    // La pagina murio a los 5 minutos de lectura: es lo que se ve al reabrir 20 s despues.
    const saved = { ...stored, lastSeen: stored.startedAt + 300_000 };
    first.view.unmount();

    const env = createFocusEnv();
    env.stored = saved;
    env.advance(320_000);
    const gate = createReloadGate(vi.fn());
    const view = render(<Probe env={env} gate={gate} onSession={(s) => (holder.current = s)} />);
    await flush();
    expect(hook().snapshot?.phase).toBe("invalidated");
    expect(gate.isBlocked()).toBe(false);
    expect(env.invalidated).toHaveLength(1);
    view.unmount();
  });
});

describe("GracePeriodBanner", () => {
  it("muestra los segundos que quedan, redondeando hacia arriba", () => {
    const view = render(<GracePeriodBanner variant="grace" graceRemainingMs={10_800} />);
    expect(view.container.textContent).toContain("11 s");
    expect(view.container.querySelector("[role=status]")).not.toBeNull();
    view.unmount();
  });

  it("en la variante invalidada avisa con calma y como alerta", () => {
    const view = render(<GracePeriodBanner variant="invalidated" />);
    expect(view.container.querySelector("[role=alert]")?.textContent).toContain("15 segundos");
    view.unmount();
  });
});
