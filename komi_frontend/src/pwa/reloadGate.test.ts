import { describe, expect, it, vi } from "vitest";
import { createReloadGate } from "./reloadGate";

describe("reloadGate", () => {
  it("recarga de inmediato si nadie la bloquea", () => {
    const reload = vi.fn();
    const gate = createReloadGate(reload);
    gate.request();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("aplaza la recarga mientras haya un bloqueo y la hace al soltarlo", () => {
    const reload = vi.fn();
    const gate = createReloadGate(reload);
    const release = gate.block();
    expect(gate.isBlocked()).toBe(true);
    gate.request();
    expect(reload).not.toHaveBeenCalled();
    release();
    expect(gate.isBlocked()).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("con dos bloqueos espera al ultimo", () => {
    const reload = vi.fn();
    const gate = createReloadGate(reload);
    const a = gate.block();
    const b = gate.block();
    gate.request();
    a();
    expect(reload).not.toHaveBeenCalled();
    b();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("soltar un bloqueo dos veces no libera el de otro", () => {
    const reload = vi.fn();
    const gate = createReloadGate(reload);
    const a = gate.block();
    gate.block();
    gate.request();
    a();
    a();
    expect(gate.isBlocked()).toBe(true);
    expect(reload).not.toHaveBeenCalled();
  });

  it("soltar sin recarga pendiente no recarga", () => {
    const reload = vi.fn();
    const gate = createReloadGate(reload);
    gate.block()();
    expect(reload).not.toHaveBeenCalled();
  });

  it("una recarga pendiente se hace una sola vez", () => {
    const reload = vi.fn();
    const gate = createReloadGate(reload);
    const release = gate.block();
    gate.request();
    gate.request();
    release();
    gate.block()();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
