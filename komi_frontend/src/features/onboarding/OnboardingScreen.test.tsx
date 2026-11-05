import { readFileSync } from "node:fs";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../../core/theme/ThemeContext";
import type { KomiDatabase } from "../../data/local_db/dexieDatabase";
import { StorageUnavailableError } from "../../data/local_db/errors";
import { createLocalMetaRepository, META_KEYS } from "../../data/local_db/localMetaRepository";
import { createLocalProfileRepository } from "../../data/local_db/localProfileRepository";
import { REMINDER_FILENAME } from "../../services/calendarReminderService";
import {
  createOnboardingService,
  type CompleteOnboardingResult,
  type OnboardingService,
} from "../../services/onboardingService";
import { createTestDb, fakeClock, uuid } from "../../test/db";
import { render } from "../../test/render";
import { OnboardingScreen } from "./OnboardingScreen";
import { QUESTIONS } from "./onboardingQuestions";

let db: KomiDatabase;
let mounted: ReturnType<typeof render> | null = null;

beforeEach(() => {
  db = createTestDb();
  document.documentElement.removeAttribute("data-theme");
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }) as never,
  );
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  db.close();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

interface Harness {
  root: HTMLElement;
  onProfileCreated: ReturnType<typeof vi.fn>;
  onFinish: ReturnType<typeof vi.fn>;
  downloadIcs: ReturnType<typeof vi.fn>;
  newId: ReturnType<typeof vi.fn>;
  service: Pick<OnboardingService, "completeOnboarding">;
}

function mountScreen(overrides: Partial<{ service: Pick<OnboardingService, "completeOnboarding"> }> = {}): Harness {
  const clock = fakeClock();
  const profiles = createLocalProfileRepository(db, clock, undefined);
  const service = overrides.service ?? createOnboardingService(db, clock, profiles);
  const onProfileCreated = vi.fn();
  const onFinish = vi.fn();
  const downloadIcs = vi.fn();
  const newId = vi.fn(() => uuid(1));
  mounted = render(
    <ThemeProvider>
      <OnboardingScreen
        service={service}
        onProfileCreated={onProfileCreated}
        onFinish={onFinish}
        downloadIcs={downloadIcs}
        newId={newId}
        now={() => new Date(2026, 10, 5, 10, 0, 0)}
      />
    </ThemeProvider>,
  );
  return { root: mounted.container, onProfileCreated, onFinish, downloadIcs, newId, service };
}

async function tap(element: Element | null | undefined) {
  if (!element) throw new Error("Elemento no encontrado");
  await act(async () => {
    (element as HTMLElement).click();
    // fake-indexeddb resuelve en macrotareas: se deja que Dexie termine antes de seguir.
    await new Promise((resolve) => setTimeout(resolve, 25));
  });
}

function button(root: HTMLElement, text: string): HTMLButtonElement | null {
  return (
    [...root.querySelectorAll("button")].find((b) => b.textContent?.trim() === text) ?? null
  );
}

function radio(root: HTMLElement, value: string): HTMLInputElement {
  const input = root.querySelector<HTMLInputElement>(`input[type="radio"][value="${value}"]`);
  if (!input) throw new Error(`No hay opcion ${value}`);
  return input;
}

const text = (root: HTMLElement) => root.textContent ?? "";
const blocks = (root: HTMLElement) => root.querySelectorAll("[data-block]").length;

async function start(h: Harness) {
  await tap(button(h.root, "Comenzar"));
}

/** Responde la pregunta actual y avanza. */
async function answer(h: Harness, value: string) {
  await tap(radio(h.root, value));
  await tap(button(h.root, "Continuar") ?? button(h.root, "Generar Plan de Hábito"));
}

async function completeQuiz(h: Harness, values: string[]) {
  await start(h);
  for (const value of values) await answer(h, value);
}

describe("bienvenida", () => {
  it("muestra la bienvenida de CU-01 con un solo boton y sin Atras", () => {
    const h = mountScreen();
    expect(text(h.root)).toContain("Bienvenido a Komi");
    expect(button(h.root, "Comenzar")).not.toBeNull();
    expect(button(h.root, "Atrás")).toBeNull();
    expect(blocks(h.root)).toBeLessThanOrEqual(4);
  });
});

describe("cuestionario", () => {
  it("las 5 preguntas y sus opciones son las del SRS 5", async () => {
    const h = mountScreen();
    await start(h);
    const seen: string[][] = [];
    for (let i = 0; i < QUESTIONS.length; i += 1) {
      const question = QUESTIONS[i];
      expect(h.root.querySelector("h1")?.textContent).toBe(question?.question);
      seen.push([...h.root.querySelectorAll(".quiz-option__label")].map((l) => l.textContent ?? ""));
      await answer(h, "A");
    }
    expect(seen).toEqual([
      [
        "Estoy empezando desde cero",
        "Leo de vez en cuando (1 a 3 libros al año)",
        "Tengo el hábito (4 a 8 libros al año)",
        "Soy lector frecuente (+8 libros al año)",
      ],
      [
        "10 minutos (Semilla ligera)",
        "15 minutos (Equilibrio Zen)",
        "30 minutos (Inmersión media)",
        "45 minutos o más (Lectura profunda)",
      ],
      [
        "Al despertar (07:30 AM)",
        "En la pausa de la tarde (03:00 PM)",
        "Antes de dormir (09:30 PM)",
        "En trayectos o tiempos libres (12:30 PM)",
      ],
      [
        "Las notificaciones y distracciones del celular",
        "El cansancio o sueño al leer",
        "Olvidar lo que leí en capítulos anteriores",
        "Empezar con metas muy altas y abandonar rápido",
      ],
      [
        "Retos suaves de memoria para no perder el hilo",
        "Analizar el trasfondo, psicología e ideas del autor",
        "Destilar un resumen práctico con las ideas clave",
      ],
    ]);
    expect(QUESTIONS.map((q) => q.question)).toEqual([
      "¿Cómo describirías tu ritmo de lectura actual?",
      "¿Cuánto tiempo de calma puedes regalarle hoy a tu lectura diaria?",
      "¿En qué momento del día tu mente se siente más despejada para leer?",
      "¿Qué suele apagar tu concentración cuando intentas mantener el hábito?",
      "Al terminar tu sesión, ¿cómo te gustaría reflexionar con Komi?",
    ]);
  });

  it("Continuar espera una respuesta; la primera pregunta no tiene Atras", async () => {
    const h = mountScreen();
    await start(h);
    expect(text(h.root)).toContain("Pregunta 1 de 5");
    expect(button(h.root, "Atrás")).toBeNull();
    expect(button(h.root, "Continuar")?.disabled).toBe(true);
    await tap(radio(h.root, "B"));
    expect(button(h.root, "Continuar")?.disabled).toBe(false);
    await tap(button(h.root, "Continuar"));
    expect(text(h.root)).toContain("Pregunta 2 de 5");
    expect(button(h.root, "Atrás")).not.toBeNull();
    expect(button(h.root, "Continuar")?.disabled).toBe(true);
  });

  it("la ultima pregunta ofrece 'Generar Plan de Hábito'", async () => {
    const h = mountScreen();
    await completeQuiz(h, ["B", "B", "A", "A"]);
    expect(text(h.root)).toContain("Pregunta 5 de 5");
    expect(button(h.root, "Continuar")).toBeNull();
    expect(button(h.root, "Generar Plan de Hábito")?.disabled).toBe(true);
    await tap(radio(h.root, "B"));
    expect(button(h.root, "Generar Plan de Hábito")?.disabled).toBe(false);
  });

  it("FA-1.1: Atras conserva las respuestas, se puede cambiar una y las demas siguen", async () => {
    const h = mountScreen();
    await completeQuiz(h, ["B", "A", "A"]); // q1=B, q2=A (10 min), q3=A; ahora en la pregunta 4
    expect(text(h.root)).toContain("Pregunta 4 de 5");
    await tap(button(h.root, "Atrás")); // pregunta 3
    expect(radio(h.root, "A").checked).toBe(true);
    await tap(button(h.root, "Atrás")); // pregunta 2
    expect(radio(h.root, "A").checked).toBe(true);
    await tap(radio(h.root, "C")); // cambia q2 a 30 minutos
    await tap(button(h.root, "Continuar")); // pregunta 3 conserva su respuesta
    expect(text(h.root)).toContain("Pregunta 3 de 5");
    expect(radio(h.root, "A").checked).toBe(true);
    await tap(button(h.root, "Atrás"));
    await tap(button(h.root, "Atrás")); // pregunta 1 conserva q1=B
    expect(text(h.root)).toContain("Pregunta 1 de 5");
    expect(radio(h.root, "B").checked).toBe(true);
    await tap(button(h.root, "Continuar"));
    await tap(button(h.root, "Continuar"));
    await tap(button(h.root, "Continuar")); // pregunta 4
    await answer(h, "A");
    await answer(h, "B");
    const stored = await createLocalProfileRepository(db).getProfile();
    expect(stored?.daily_goal_minutes).toBe(30); // el cambio de q2 llego al plan
  });

  it("el progreso se anuncia y el foco va al titulo al cambiar de pregunta", async () => {
    const h = mountScreen();
    await start(h);
    const bar = () => h.root.querySelector('[role="progressbar"]');
    expect(bar()?.getAttribute("aria-valuenow")).toBe("1");
    expect(bar()?.getAttribute("aria-valuemax")).toBe("5");
    expect(document.activeElement?.tagName).toBe("H1");
    await answer(h, "A");
    expect(bar()?.getAttribute("aria-valuenow")).toBe("2");
    expect(document.activeElement?.tagName).toBe("H1");
    expect(document.activeElement?.textContent).toBe(QUESTIONS[1]?.question);
  });

  it("las opciones son un grupo de radios etiquetado por la pregunta", async () => {
    const h = mountScreen();
    await start(h);
    const group = h.root.querySelector('[role="radiogroup"]');
    expect(group?.getAttribute("aria-labelledby")).toBe(h.root.querySelector("h1")?.id);
    expect(h.root.querySelectorAll('input[type="radio"][name="q1"]').length).toBe(4);
  });

  it("una pantalla de pregunta tiene como maximo 4 bloques funcionales", async () => {
    const h = mountScreen();
    await start(h);
    expect(blocks(h.root)).toBe(3);
  });
});

describe("generar el plan", () => {
  it("calcula el plan, lo guarda en Dexie y deja la cola, sin tocar la red", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const h = mountScreen();
    await completeQuiz(h, ["B", "B", "A", "A", "B"]);
    const profile = await createLocalProfileRepository(db).getProfile();
    expect(profile).toMatchObject({
      profile_id: uuid(1),
      daily_goal_minutes: 15,
      preferred_moment: "MORNING",
      ai_reflection_style: "DEEP_ANALYSIS",
    });
    const pending = await createLocalMetaRepository(db).get(META_KEYS.onboardingPending);
    expect(JSON.parse(String(pending)).answers).toEqual({ q1: "B", q2: "B", q3: "A", q4: "A", q5: "B" });
    expect(h.onProfileCreated).toHaveBeenCalledOnce();
    const result = h.onProfileCreated.mock.calls[0]?.[0] as CompleteOnboardingResult;
    expect(result.created).toBe(true);
    expect(h.newId).toHaveBeenCalledOnce();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("un doble toque no crea dos perfiles", async () => {
    let resolve: (value: CompleteOnboardingResult) => void = () => {};
    const completeOnboarding = vi.fn(
      () => new Promise<CompleteOnboardingResult>((r) => (resolve = r)),
    );
    const h = mountScreen({ service: { completeOnboarding } });
    await completeQuiz(h, ["B", "B", "A", "A"]);
    await tap(radio(h.root, "B"));
    const generate = button(h.root, "Generar Plan de Hábito");
    await tap(generate);
    await tap(button(h.root, "Guardando tu plan"));
    await tap(button(h.root, "Guardando tu plan"));
    expect(completeOnboarding).toHaveBeenCalledOnce();
    expect(button(h.root, "Guardando tu plan")?.disabled).toBe(true);
    expect(button(h.root, "Atrás")?.disabled).toBe(true);
    await act(async () => resolve({ profile: {} as never, plan: planOf(), created: true }));
  });

  it("si falla el almacenamiento avisa, conserva las respuestas y reintenta con el mismo UUID", async () => {
    const completeOnboarding = vi
      .fn<OnboardingService["completeOnboarding"]>()
      .mockRejectedValueOnce(new StorageUnavailableError())
      .mockImplementationOnce(async () => ({ profile: {} as never, plan: planOf(), created: true }));
    const h = mountScreen({ service: { completeOnboarding } });
    await completeQuiz(h, ["B", "B", "A", "A", "B"]);
    expect(h.root.querySelector('[role="alert"]')?.textContent).toContain(
      "No se puede usar el almacenamiento del dispositivo",
    );
    expect(h.onProfileCreated).not.toHaveBeenCalled();
    expect(radio(h.root, "B").checked).toBe(true); // la respuesta sigue marcada
    await tap(button(h.root, "Generar Plan de Hábito"));
    expect(completeOnboarding).toHaveBeenCalledTimes(2);
    expect(completeOnboarding.mock.calls[0]?.[0].profile_id).toBe(completeOnboarding.mock.calls[1]?.[0].profile_id);
    expect(h.newId).toHaveBeenCalledOnce();
    expect(text(h.root)).toContain("Tu plan Zen está listo");
  });

  it("un error desconocido muestra un mensaje generico", async () => {
    const completeOnboarding = vi.fn().mockRejectedValue(new Error("boom"));
    const h = mountScreen({ service: { completeOnboarding } });
    await completeQuiz(h, ["B", "B", "A", "A", "B"]);
    expect(h.root.querySelector('[role="alert"]')?.textContent).toBe(
      "No pudimos guardar tu plan. Inténtalo de nuevo.",
    );
  });
});

function planOf() {
  return {
    daily_goal_minutes: 15,
    preferred_moment: "MORNING" as const,
    ai_reflection_style: "DEEP_ANALYSIS" as const,
    preconfigure_tsukimi: false,
  };
}

describe("confirmacion del plan", () => {
  it("resume la meta, la hora y el estilo, con 4 bloques como maximo", async () => {
    const h = mountScreen();
    await completeQuiz(h, ["B", "C", "A", "A", "C"]);
    const summary = h.root.querySelector('[data-block="summary"]');
    expect(text(h.root)).toContain("Tu plan Zen está listo");
    expect(summary?.textContent).toContain("Meta diaria30 minutos");
    expect(summary?.textContent).toContain("Recordatorio07:30");
    expect(summary?.textContent).toContain("Reflexión con KomiResumen con ideas clave");
    expect(blocks(h.root)).toBe(4);
    expect([...h.root.querySelectorAll("[data-block]")].map((b) => b.getAttribute("data-block"))).toEqual([
      "hero",
      "summary",
      "reminder",
      "actions",
    ]);
  });

  it.each([
    ["A", "07:30"],
    ["B", "15:00"],
    ["C", "21:30"],
    ["D", "12:30"],
  ])("la opcion %s de la pregunta 3 ofrece el recordatorio a las %s", async (q3, time) => {
    const h = mountScreen();
    await completeQuiz(h, ["B", "B", q3, "A", "B"]);
    expect(h.root.querySelector('[data-block="reminder"]')?.textContent).toContain(`a las ${time}.`);
    mounted?.unmount();
    mounted = null;
    db.close();
    db = createTestDb();
  });

  it("Ir al Dashboard avisa a la app", async () => {
    const h = mountScreen();
    await completeQuiz(h, ["B", "B", "A", "A", "B"]);
    await tap(button(h.root, "Ir al Dashboard"));
    expect(h.onFinish).toHaveBeenCalledOnce();
  });

  it("fatiga nocturna: avisa de Tsukimi y no ofrece el boton de prueba", async () => {
    const h = mountScreen();
    await completeQuiz(h, ["B", "C", "C", "B", "B"]); // q3 noche, q4 cansancio, 30 min
    expect(text(h.root)).toContain("Activamos el modo oscuro Tsukimi");
    expect(button(h.root, "Probar modo oscuro")).toBeNull();
    expect(h.onProfileCreated.mock.calls[0]?.[0].plan.preconfigure_tsukimi).toBe(true);
  });

  it("para 'Antes de dormir' sin fatiga sugiere el modo oscuro dentro del resumen", async () => {
    const h = mountScreen();
    await completeQuiz(h, ["B", "B", "C", "A", "B"]);
    const trial = button(h.root, "Probar modo oscuro");
    expect(trial).not.toBeNull();
    expect(trial?.closest('[data-block="summary"]')).not.toBeNull();
    expect(blocks(h.root)).toBe(4); // no es un quinto bloque
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    await tap(trial);
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(button(h.root, "Probar modo oscuro")).toBeNull();
  });

  it("otros momentos no sugieren el modo oscuro", async () => {
    const h = mountScreen();
    await completeQuiz(h, ["B", "B", "B", "A", "B"]);
    expect(button(h.root, "Probar modo oscuro")).toBeNull();
    expect(text(h.root)).not.toContain("Tsukimi");
  });
});

describe("banner del recordatorio y .ics", () => {
  it("Añadir al calendario descarga un .ics con la hora y la meta del plan", async () => {
    const h = mountScreen();
    await completeQuiz(h, ["B", "C", "C", "A", "B"]); // 30 min, noche
    await tap(button(h.root, "Añadir al calendario"));
    expect(h.downloadIcs).toHaveBeenCalledOnce();
    const [ics, filename] = h.downloadIcs.mock.calls[0] as [string, string];
    expect(filename).toBe(REMINDER_FILENAME);
    expect(ics).toContain("\r\nDTSTART:20261105T213000\r\n");
    expect(ics).toContain("\r\nDURATION:PT30M\r\n");
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(h.root.querySelector('[role="status"]')?.textContent).toContain("Abre el archivo descargado");
    expect(button(h.root, "Añadir al calendario")).toBeNull();
  });

  it("Ahora no retira el banner sin descargar nada", async () => {
    const h = mountScreen();
    await completeQuiz(h, ["B", "B", "A", "A", "B"]);
    await tap(button(h.root, "Ahora no"));
    expect(h.root.querySelector('[data-block="reminder"]')).toBeNull();
    expect(h.downloadIcs).not.toHaveBeenCalled();
    expect(blocks(h.root)).toBe(3);
  });

  it("si la descarga falla avisa y deja intentarlo de nuevo", async () => {
    const h = mountScreen();
    h.downloadIcs.mockImplementationOnce(() => {
      throw new Error("sin descargas");
    });
    await completeQuiz(h, ["B", "B", "A", "A", "B"]);
    await tap(button(h.root, "Añadir al calendario"));
    expect(h.root.querySelector('[role="alert"]')?.textContent).toBe(
      "No pudimos preparar el recordatorio. Inténtalo de nuevo.",
    );
    await tap(button(h.root, "Añadir al calendario"));
    expect(h.downloadIcs).toHaveBeenCalledTimes(2);
    expect(h.root.querySelector('[role="alert"]')).toBeNull();
    expect(h.root.querySelector('[role="status"]')).not.toBeNull();
  });
});

describe("textos", () => {
  const MISSING_ACCENTS =
    /\b(habito|atras|jardin|estadisticas|reflexion|analisis|inmersion|anade|anadir|psicologia|practico|despues|dia|dias|mas|esta listo)\b/i;

  async function everyScreenText(): Promise<string[]> {
    const h = mountScreen();
    const texts = [text(h.root)];
    await start(h);
    for (const q of ["B", "C", "C", "B"]) {
      texts.push(text(h.root));
      await answer(h, q);
    }
    texts.push(text(h.root));
    await tap(radio(h.root, "B"));
    await tap(button(h.root, "Generar Plan de Hábito"));
    texts.push(text(h.root));
    await tap(button(h.root, "Añadir al calendario"));
    texts.push(text(h.root));
    return texts;
  }

  it("llevan tildes y no hay emojis en ninguna pantalla", async () => {
    const texts = await everyScreenText();
    expect(texts.length).toBeGreaterThan(6);
    for (const t of texts) {
      expect(t).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(t).not.toMatch(/Pregunta\d/);
    }
    const all = texts.join("\n");
    for (const word of [
      "Hábito",
      "Atrás",
      "Generar Plan de Hábito",
      "está listo",
      "Reflexión con Komi",
      "Añadir al calendario",
      "Inmersión media",
      "Análisis de trasfondo",
    ]) {
      expect(all, word).toContain(word);
    }
    expect(all).not.toMatch(MISSING_ACCENTS);
  });
});

describe("detalles visuales", () => {
  it("la barra de progreso avanza 20 por ciento por pregunta", async () => {
    const h = mountScreen();
    await start(h);
    const fill = () => h.root.querySelector<HTMLElement>(".onboarding__bar-fill")?.style.width;
    expect(fill()).toBe("20%");
    await answer(h, "A");
    expect(fill()).toBe("40%");
  });

  it("solo la opcion elegida se marca, con su icono de check", async () => {
    const h = mountScreen();
    await start(h);
    const cards = () => [...h.root.querySelectorAll(".quiz-option")];
    expect(cards().map((c) => c.getAttribute("data-selected"))).toEqual(["false", "false", "false", "false"]);
    expect(h.root.querySelectorAll(".quiz-option svg").length).toBe(0);
    await tap(radio(h.root, "C"));
    expect(cards().map((c) => c.getAttribute("data-selected"))).toEqual(["false", "false", "true", "false"]);
    expect(cards()[2]?.querySelector("svg")).not.toBeNull();
    expect(h.root.querySelectorAll(".quiz-option svg").length).toBe(1);
  });

  it("el estilo de reflexion usa el nombre corto del resumen", async () => {
    const h = mountScreen();
    await completeQuiz(h, ["B", "B", "A", "A", "A"]);
    expect(h.root.querySelector('[data-block="summary"]')?.textContent).toContain("Retos suaves de memoria");
  });

  it("al reintentar se limpia el error anterior mientras guarda", async () => {
    let resolve: (value: CompleteOnboardingResult) => void = () => {};
    const completeOnboarding = vi
      .fn<OnboardingService["completeOnboarding"]>()
      .mockRejectedValueOnce(new Error("x"))
      .mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    const h = mountScreen({ service: { completeOnboarding } });
    await completeQuiz(h, ["B", "B", "A", "A", "B"]);
    expect(h.root.querySelector('[role="alert"]')).not.toBeNull();
    await tap(button(h.root, "Generar Plan de Hábito"));
    expect(h.root.querySelector('[role="alert"]')).toBeNull();
    await act(async () => resolve({ profile: {} as never, plan: planOf(), created: true }));
  });

  it("la tarjeta de opcion cumple SRS 10.4 en su CSS", () => {
    const css = readFileSync("src/features/onboarding/QuizOptionCard.css", "utf-8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css).toMatch(/\.quiz-option\s*\{[^}]*min-height:\s*60px;/);
    expect(css).toMatch(/\.quiz-option\s*\{[^}]*border:\s*2px solid transparent;/);
    expect(css).toMatch(/\.quiz-option\[data-selected="true"\]\s*\{[^}]*border-color:\s*var\(--color-accent-secondary\);/);
    expect(css).toMatch(/\.quiz-option\[data-selected="true"\]\s*\{[^}]*background:\s*var\(--color-bg-primary\);/);
    expect(css).not.toMatch(/#[0-9a-f]{3,8}(?![0-9a-f])/i);
  });
});
