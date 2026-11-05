import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KomiDatabase } from "../data/local_db/dexieDatabase";
import { InvalidProfileError } from "../data/local_db/errors";
import { createLocalMetaRepository, META_KEYS } from "../data/local_db/localMetaRepository";
import { createLocalProfileRepository } from "../data/local_db/localProfileRepository";
import { createTestDb, fakeClock, uuid } from "../test/db";
import { calculateHabitPlan, isCompleteAnswers, type OnboardingAnswers } from "./habitPlan";
import { createOnboardingService } from "./onboardingService";

let db: KomiDatabase;
beforeEach(() => {
  db = createTestDb();
});
afterEach(() => db.close());

const answers: OnboardingAnswers = { q1: "B", q2: "C", q3: "C", q4: "B", q5: "B" };

function service() {
  const clock = fakeClock();
  const profiles = createLocalProfileRepository(db, clock, undefined);
  return { svc: createOnboardingService(db, clock, profiles), profiles };
}

describe("isCompleteAnswers", () => {
  it("acepta las 5 respuestas validas", () => {
    expect(isCompleteAnswers(answers)).toBe(true);
    expect(isCompleteAnswers({ q1: "D", q2: "D", q3: "D", q4: "D", q5: "C" })).toBe(true);
  });

  it("rechaza faltantes, valores fuera de rango y q5 con D", () => {
    expect(isCompleteAnswers({ ...answers, q3: undefined })).toBe(false);
    expect(isCompleteAnswers({ ...answers, q1: "E" })).toBe(false);
    expect(isCompleteAnswers({ ...answers, q5: "D" })).toBe(false);
    expect(isCompleteAnswers({ ...answers, q4: "E" })).toBe(false);
    expect(isCompleteAnswers({ ...answers, q4: undefined })).toBe(false);
    expect(isCompleteAnswers({ ...answers, q2: 5 })).toBe(false);
    expect(isCompleteAnswers({ ...answers, q2: "a" })).toBe(false);
    expect(isCompleteAnswers(null)).toBe(false);
    expect(isCompleteAnswers("ABCDA")).toBe(false);
  });
});

describe("completeOnboarding", () => {
  it("calcula el plan en local con el algoritmo compartido y lo guarda en el perfil", async () => {
    const { svc, profiles } = service();
    const result = await svc.completeOnboarding({ profile_id: uuid(1), answers });
    const expected = calculateHabitPlan(answers);
    expect(result.created).toBe(true);
    expect(result.plan).toEqual(expected);
    expect(expected).toMatchObject({ daily_goal_minutes: 15, preconfigure_tsukimi: true });
    const stored = await profiles.getProfile();
    expect(stored).toMatchObject({
      profile_id: uuid(1),
      daily_goal_minutes: 15,
      preferred_moment: "NIGHT",
      ai_reflection_style: "DEEP_ANALYSIS",
      preconfigure_tsukimi: true,
      onboarding_synced: false,
    });
  });

  it("deja el POST en cola en la misma transaccion, con el UUID y las respuestas", async () => {
    const { svc } = service();
    await svc.completeOnboarding({ profile_id: uuid(2), answers });
    const raw = await createLocalMetaRepository(db).get(META_KEYS.onboardingPending);
    expect(JSON.parse(String(raw))).toEqual({ profile_id: uuid(2), answers });
  });

  it("si falla la cola no queda un perfil a medias", async () => {
    const { svc, profiles } = service();
    vi.spyOn(db.meta, "put").mockRejectedValueOnce(new Error("fallo al escribir la cola"));
    await expect(svc.completeOnboarding({ profile_id: uuid(3), answers })).rejects.toThrow();
    expect(await profiles.getProfile()).toBeUndefined();
    expect(await createLocalMetaRepository(db).get(META_KEYS.onboardingPending)).toBeUndefined();
  });

  it("un segundo intento con el mismo UUID no modifica el perfil ni vuelve a encolar", async () => {
    const { svc } = service();
    await svc.completeOnboarding({ profile_id: uuid(4), answers });
    await createLocalMetaRepository(db).remove(META_KEYS.onboardingPending);
    const again = await svc.completeOnboarding({
      profile_id: uuid(4),
      answers: { q1: "A", q2: "A", q3: "A", q4: "A", q5: "A" },
    });
    expect(again.created).toBe(false);
    expect(again.profile.daily_goal_minutes).toBe(15);
    expect(again.plan).toMatchObject({ daily_goal_minutes: 15, preferred_moment: "NIGHT" });
    expect(await createLocalMetaRepository(db).get(META_KEYS.onboardingPending)).toBeUndefined();
  });

  it("un perfil existente con otro UUID gana y no se encola nada", async () => {
    const { svc } = service();
    await svc.completeOnboarding({ profile_id: uuid(5), answers });
    await createLocalMetaRepository(db).remove(META_KEYS.onboardingPending);
    const other = await svc.completeOnboarding({ profile_id: uuid(6), answers });
    expect(other.created).toBe(false);
    expect(other.profile.profile_id).toBe(uuid(5));
    expect(await createLocalMetaRepository(db).get(META_KEYS.onboardingPending)).toBeUndefined();
  });

  it("rechaza un UUID invalido y respuestas incompletas sin escribir nada", async () => {
    const { svc, profiles } = service();
    await expect(svc.completeOnboarding({ profile_id: "x", answers })).rejects.toBeInstanceOf(
      InvalidProfileError,
    );
    await expect(
      svc.completeOnboarding({ profile_id: uuid(7), answers: { ...answers, q5: "D" } as never }),
    ).rejects.toBeInstanceOf(InvalidProfileError);
    expect(await profiles.getProfile()).toBeUndefined();
  });

  it("un UUID invalido se rechaza aunque ya exista un perfil", async () => {
    const { svc } = service();
    await svc.completeOnboarding({ profile_id: uuid(10), answers });
    await expect(svc.completeOnboarding({ profile_id: "no-es-uuid", answers })).rejects.toBeInstanceOf(
      InvalidProfileError,
    );
  });

  it("no toca la red", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { svc } = service();
    await svc.completeOnboarding({ profile_id: uuid(8), answers });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe("meta", () => {
  it("la racha es 0 sin dato o con un dato invalido, y el valor entero si existe", async () => {
    const meta = createLocalMetaRepository(db);
    expect(await meta.getStreakCurrent()).toBe(0);
    await meta.set(META_KEYS.streakCurrent, 5);
    expect(await meta.getStreakCurrent()).toBe(5);
    for (const bad of [-2, 1.5, "7", null, true]) {
      await meta.set(META_KEYS.streakCurrent, bad);
      expect(await meta.getStreakCurrent()).toBe(0);
    }
  });

  it("set, get y remove", async () => {
    const meta = createLocalMetaRepository(db);
    await meta.set("k", "v");
    expect(await meta.get("k")).toBe("v");
    await meta.remove("k");
    expect(await meta.get("k")).toBeUndefined();
  });
});
