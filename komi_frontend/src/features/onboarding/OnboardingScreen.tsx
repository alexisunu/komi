// Onboarding (CU-01): bienvenida, 5 preguntas, y confirmacion del plan con el recordatorio.
// El estado de la pantalla es local y minimo; el plan lo calcula onboardingService con el
// algoritmo compartido y se guarda en Dexie ANTES de tocar la red (SRS 18, punto 11).

import { useEffect, useMemo, useRef, useState } from "react";
import { ZenPrimaryButton } from "../../core/components/ZenPrimaryButton";
import { useTheme } from "../../core/theme/ThemeContext";
import { newProfileId } from "../../data/uuid";
import { KomiLocalError } from "../../data/local_db/errors";
import {
  buildReminderIcs,
  downloadReminderIcs,
  REMINDER_FILENAME,
} from "../../services/calendarReminderService";
import { isCompleteAnswers, type OnboardingAnswers } from "../../services/habitPlan";
import {
  createOnboardingService,
  type CompleteOnboardingResult,
  type OnboardingService,
} from "../../services/onboardingService";
import { SunflowerStageWidget } from "../dashboard/SunflowerStageWidget";
import {
  QUESTION_COUNT,
  QUESTIONS,
  REFLECTION_STYLE_LABELS,
} from "./onboardingQuestions";
import { QuizOptionCard } from "./QuizOptionCard";
import { formatReminderTime, ReminderBanner, type ReminderState } from "./ReminderBanner";
import "./OnboardingScreen.css";

type Phase = "welcome" | "quiz" | "plan";

export interface OnboardingScreenProps {
  /** El perfil ya esta en Dexie. La app actualiza el tema y empieza a sincronizar. */
  onProfileCreated: (result: CompleteOnboardingResult) => void;
  /** "Ir al Dashboard". */
  onFinish: () => void;
  service?: Pick<OnboardingService, "completeOnboarding">;
  newId?: () => string;
  now?: () => Date;
  downloadIcs?: (ics: string, filename?: string) => void;
}

const SAVE_ERROR = "No pudimos guardar tu plan. Inténtalo de nuevo.";
const ICS_ERROR = "No pudimos preparar el recordatorio. Inténtalo de nuevo.";

export function OnboardingScreen({
  onProfileCreated,
  onFinish,
  service,
  newId = newProfileId,
  now = () => new Date(),
  downloadIcs = downloadReminderIcs,
}: OnboardingScreenProps) {
  const { theme, setTheme } = useTheme();
  const defaultService = useMemo(() => createOnboardingService(), []);
  const svc = service ?? defaultService;

  const [phase, setPhase] = useState<Phase>("welcome");
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Partial<OnboardingAnswers>>({});
  const [result, setResult] = useState<CompleteOnboardingResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [reminder, setReminder] = useState<ReminderState>("offer");
  const [reminderError, setReminderError] = useState<string | null>(null);

  // El UUID se genera una sola vez: un reintento o un doble toque no crea otro perfil.
  const profileId = useRef<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  // Al cambiar de pantalla o de pregunta, el foco va al titulo (lector de pantalla y teclado).
  useEffect(() => {
    heading.current?.focus();
  }, [phase, step]);

  const question = QUESTIONS[step];
  const current = question ? answers[question.id] : undefined;
  const isLast = step === QUESTION_COUNT - 1;

  function select(value: string) {
    if (!question) return;
    setAnswers((previous) => ({ ...previous, [question.id]: value }));
  }

  async function generate() {
    if (saving || !isCompleteAnswers(answers)) return;
    setSaving(true);
    setSaveError(null);
    profileId.current ??= newId();
    try {
      const saved = await svc.completeOnboarding({ profile_id: profileId.current, answers });
      setResult(saved);
      onProfileCreated(saved);
      setPhase("plan");
    } catch (error) {
      setSaveError(error instanceof KomiLocalError ? error.message : SAVE_ERROR);
    } finally {
      setSaving(false);
    }
  }

  function next() {
    if (isLast) void generate();
    else setStep((value) => value + 1);
  }

  function addReminder() {
    if (!result) return;
    try {
      const date = now();
      const ics = buildReminderIcs({
        moment: result.plan.preferred_moment,
        durationMinutes: result.plan.daily_goal_minutes,
        startDate: date,
        now: date,
      });
      downloadIcs(ics, REMINDER_FILENAME);
      setReminderError(null);
      setReminder("added");
    } catch {
      setReminderError(ICS_ERROR);
    }
  }

  if (phase === "welcome") {
    return (
      <main className="onboarding" data-screen="welcome">
        <div className="onboarding__center" data-block="welcome">
          <SunflowerStageWidget percentage={0} size={180} />
          <h1 className="onboarding__title" ref={heading} tabIndex={-1}>
            Bienvenido a Komi
          </h1>
          <p className="onboarding__lead">
            Tu hábito de lectura crece como un girasol: poco a poco, a tu ritmo. Responde cinco
            preguntas breves y prepararemos un plan a tu medida.
          </p>
        </div>
        <div className="onboarding__actions" data-block="actions">
          <ZenPrimaryButton onClick={() => setPhase("quiz")}>Comenzar</ZenPrimaryButton>
        </div>
      </main>
    );
  }

  if (phase === "quiz" && question) {
    return (
      <main className="onboarding" data-screen="quiz">
        <header className="onboarding__progress" data-block="progress">
          <div className="onboarding__progress-text">
            <span className="tabular">
              Pregunta {step + 1} de {QUESTION_COUNT}
            </span>
            <span className="onboarding__category">{question.category}</span>
          </div>
          <div
            className="onboarding__bar"
            role="progressbar"
            aria-label="Progreso del cuestionario"
            aria-valuemin={1}
            aria-valuemax={QUESTION_COUNT}
            aria-valuenow={step + 1}
          >
            <div
              className="onboarding__bar-fill"
              style={{ width: `${((step + 1) / QUESTION_COUNT) * 100}%` }}
            />
          </div>
        </header>

        <section className="onboarding__question" data-block="question">
          <h1 className="onboarding__question-title" ref={heading} tabIndex={-1} id="question-title">
            {question.question}
          </h1>
          <div role="radiogroup" aria-labelledby="question-title" className="onboarding__options">
            {question.options.map((option) => (
              <QuizOptionCard
                key={option.value}
                name={question.id}
                value={option.value}
                label={option.label}
                selected={current === option.value}
                onSelect={select}
              />
            ))}
          </div>
        </section>

        <div className="onboarding__actions onboarding__actions--row" data-block="actions">
          {saveError && (
            <p className="onboarding__error" role="alert">
              {saveError}
            </p>
          )}
          {step > 0 && (
            <ZenPrimaryButton
              variant="secondary"
              onClick={() => setStep((value) => value - 1)}
              disabled={saving}
            >
              Atrás
            </ZenPrimaryButton>
          )}
          <ZenPrimaryButton onClick={next} disabled={current === undefined || saving}>
            {saving ? "Guardando tu plan" : isLast ? "Generar Plan de Hábito" : "Continuar"}
          </ZenPrimaryButton>
        </div>
      </main>
    );
  }

  if (phase === "plan" && result) {
    const { plan } = result;
    const timeLabel = formatReminderTime(plan.preferred_moment);
    const suggestDark =
      plan.preferred_moment === "NIGHT" && !plan.preconfigure_tsukimi && theme === "light";
    return (
      <main className="onboarding" data-screen="plan">
        <div className="onboarding__center onboarding__center--compact" data-block="hero">
          <SunflowerStageWidget percentage={0} size={120} />
          <h1 className="onboarding__title" ref={heading} tabIndex={-1}>
            Tu plan Zen está listo
          </h1>
          <p className="onboarding__lead">
            Guardamos tu perfil en este dispositivo. Puedes plantar tu primer libro cuando quieras.
          </p>
        </div>

        <section className="onboarding__summary" aria-label="Resumen de tu plan" data-block="summary">
          <dl className="onboarding__rows">
            <div className="onboarding__row">
              <dt>Meta diaria</dt>
              <dd className="tabular">{plan.daily_goal_minutes} minutos</dd>
            </div>
            <div className="onboarding__row">
              <dt>Recordatorio</dt>
              <dd className="tabular">{timeLabel}</dd>
            </div>
            <div className="onboarding__row">
              <dt>Reflexión con Komi</dt>
              <dd>{REFLECTION_STYLE_LABELS[plan.ai_reflection_style]}</dd>
            </div>
          </dl>
          {plan.preconfigure_tsukimi && (
            <p className="onboarding__note">
              Activamos el modo oscuro Tsukimi, pensado para leer de noche.
            </p>
          )}
          {suggestDark && (
            <p className="onboarding__note">
              Lees de noche. ¿Quieres probar el modo oscuro?{" "}
              <button type="button" className="onboarding__link" onClick={() => setTheme("dark")}>
                Probar modo oscuro
              </button>
            </p>
          )}
        </section>

        <ReminderBanner
          timeLabel={timeLabel}
          state={reminder}
          error={reminderError}
          onAdd={addReminder}
          onDismiss={() => setReminder("dismissed")}
        />

        <div className="onboarding__actions" data-block="actions">
          <ZenPrimaryButton onClick={onFinish}>Ir al Dashboard</ZenPrimaryButton>
        </div>
      </main>
    );
  }

  return null;
}
