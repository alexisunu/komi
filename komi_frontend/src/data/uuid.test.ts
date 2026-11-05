import { describe, expect, it, vi } from "vitest";
import { isUuid } from "./local_db/sessionRules";
import { newProfileId } from "./uuid";

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("newProfileId", () => {
  it("usa crypto.randomUUID cuando existe", () => {
    const randomUUID = vi.fn(() => "00000000-0000-4000-8000-000000000042");
    const getRandomValues = vi.fn();
    expect(newProfileId({ randomUUID, getRandomValues } as never)).toBe(
      "00000000-0000-4000-8000-000000000042",
    );
    expect(randomUUID).toHaveBeenCalledOnce();
    expect(getRandomValues).not.toHaveBeenCalled();
  });

  it("el UUID real del entorno es un v4 valido y distinto cada vez", () => {
    const a = newProfileId();
    const b = newProfileId();
    expect(a).toMatch(V4);
    expect(isUuid(a)).toBe(true);
    expect(a).not.toBe(b);
  });

  it("sin randomUUID (contexto no seguro) arma un v4 con getRandomValues", () => {
    const fixed = Uint8Array.from({ length: 16 }, (_, i) => i * 16 + 15);
    const getRandomValues = vi.fn((array: Uint8Array) => {
      array.set(fixed);
      return array;
    });
    const id = newProfileId({ getRandomValues } as never);
    expect(getRandomValues).toHaveBeenCalledOnce();
    expect(id).toMatch(V4);
    expect(isUuid(id)).toBe(true);
    // Los bits de version y variante se fuerzan aunque los bytes aleatorios digan otra cosa.
    const zeros = newProfileId({
      getRandomValues: (array: Uint8Array) => array.fill(0),
    } as never);
    expect(zeros).toBe("00000000-0000-4000-8000-000000000000");
    const ones = newProfileId({
      getRandomValues: (array: Uint8Array) => array.fill(255),
    } as never);
    expect(ones).toBe("ffffffff-ffff-4fff-bfff-ffffffffffff");
  });

  it("el respaldo usa el generador criptografico real, no Math.random", () => {
    const random = vi.spyOn(Math, "random");
    const id = newProfileId({ getRandomValues: crypto.getRandomValues.bind(crypto) } as never);
    expect(id).toMatch(V4);
    expect(random).not.toHaveBeenCalled();
    random.mockRestore();
  });
});
