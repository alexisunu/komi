import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, fakeClock, uuid, type FakeClock } from "../../test/db";
import type { KomiDatabase } from "./dexieDatabase";
import { InvalidProfileError } from "./errors";
import {
  PROFILE_ID_STORAGE_KEY,
  createLocalProfileRepository,
  type SaveProfileInput,
} from "./localProfileRepository";

let db: KomiDatabase;
let clock: FakeClock;
const store = new Map<string, string>();
const storage = {
  setItem: (key: string, value: string) => {
    store.set(key, value);
  },
};

beforeEach(() => {
  db = createTestDb();
  clock = fakeClock();
  store.clear();
});
afterEach(() => db.close());

const input: SaveProfileInput = {
  profile_id: uuid(1),
  daily_goal_minutes: 15,
  preferred_moment: "NIGHT",
  ai_reflection_style: "DEEP_ANALYSIS",
  preconfigure_tsukimi: true,
};

describe("perfil local", () => {
  it("no hay perfil hasta que termina el onboarding", async () => {
    const profiles = createLocalProfileRepository(db, clock, storage);
    expect(await profiles.getProfile()).toBeUndefined();
  });

  it("crea el perfil con el profile_id, la meta y los ajustes locales", async () => {
    const profiles = createLocalProfileRepository(db, clock, storage);
    const profile = await profiles.createProfile(input);
    expect(profile).toEqual({
      id: "local",
      profile_id: uuid(1),
      daily_goal_minutes: 15,
      preferred_moment: "NIGHT",
      ai_reflection_style: "DEEP_ANALYSIS",
      theme_mode: null,
      preconfigure_tsukimi: true,
      onboarding_synced: false,
      created_at: "2026-11-05T10:00:00.000Z",
      updated_at: "2026-11-05T10:00:00.000Z",
    });
    expect(await profiles.getProfile()).toEqual(profile);
  });

  it("copia el profile_id a localStorage", async () => {
    const profiles = createLocalProfileRepository(db, clock, storage);
    await profiles.createProfile(input);
    expect(store.get(PROFILE_ID_STORAGE_KEY)).toBe(uuid(1));
  });

  it("si localStorage falla (modo privado, cuota), el perfil se guarda igual", async () => {
    const failing = {
      setItem: vi.fn(() => {
        throw new DOMException("lleno", "QuotaExceededError");
      }),
    };
    const profiles = createLocalProfileRepository(db, clock, failing);
    await expect(profiles.createProfile(input)).resolves.toMatchObject({ profile_id: uuid(1) });
    expect(failing.setItem).toHaveBeenCalled();
  });

  it("sin localStorage disponible tambien funciona", async () => {
    const profiles = createLocalProfileRepository(db, clock, undefined);
    await expect(profiles.createProfile(input)).resolves.toMatchObject({ profile_id: uuid(1) });
  });

  it("es idempotente: un segundo createProfile no reemplaza el UUID del lector", async () => {
    const profiles = createLocalProfileRepository(db, clock, storage);
    const first = await profiles.createProfile(input);
    clock.advance(1000);
    const again = await profiles.createProfile({ ...input, profile_id: uuid(2), daily_goal_minutes: 45 });
    expect(again).toEqual(first);
    expect(store.get(PROFILE_ID_STORAGE_KEY)).toBe(uuid(1));
    expect(await db.profile.count()).toBe(1);
  });

  it("rechaza un profile_id que no es UUID", async () => {
    const profiles = createLocalProfileRepository(db, clock, storage);
    await expect(profiles.createProfile({ ...input, profile_id: "abc" })).rejects.toBeInstanceOf(
      InvalidProfileError,
    );
    expect(await db.profile.count()).toBe(0);
  });

  it("preconfigure_tsukimi ausente se guarda como null", async () => {
    const profiles = createLocalProfileRepository(db, clock, storage);
    const { preconfigure_tsukimi: _omit, ...rest } = input;
    void _omit;
    expect((await profiles.createProfile(rest)).preconfigure_tsukimi).toBeNull();
  });
});

describe("ajustes locales (tema)", () => {
  it("guarda la eleccion de tema y la recuerda", async () => {
    const profiles = createLocalProfileRepository(db, clock, storage);
    await profiles.createProfile(input);
    clock.advance(1000);
    const updated = await profiles.updateProfile({ theme_mode: "dark" });
    expect(updated?.theme_mode).toBe("dark");
    expect(updated?.updated_at).toBe("2026-11-05T10:00:01.000Z");
    expect((await profiles.getProfile())?.theme_mode).toBe("dark");
  });

  it("repetir el mismo ajuste no cambia updated_at", async () => {
    const profiles = createLocalProfileRepository(db, clock, storage);
    await profiles.createProfile(input);
    await profiles.updateProfile({ theme_mode: "light" });
    clock.advance(3_600_000);
    const again = await profiles.updateProfile({ theme_mode: "light" });
    expect(again?.updated_at).toBe("2026-11-05T10:00:00.000Z");
  });

  it("se puede volver a sin eleccion (null)", async () => {
    const profiles = createLocalProfileRepository(db, clock, storage);
    await profiles.createProfile(input);
    await profiles.updateProfile({ theme_mode: "dark" });
    expect((await profiles.updateProfile({ theme_mode: null }))?.theme_mode).toBeNull();
  });

  it("marca el onboarding como sincronizado", async () => {
    const profiles = createLocalProfileRepository(db, clock, storage);
    await profiles.createProfile(input);
    expect((await profiles.updateProfile({ onboarding_synced: true }))?.onboarding_synced).toBe(true);
  });

  it("sin perfil devuelve undefined", async () => {
    const profiles = createLocalProfileRepository(db, clock, storage);
    expect(await profiles.updateProfile({ theme_mode: "dark" })).toBeUndefined();
  });
});
