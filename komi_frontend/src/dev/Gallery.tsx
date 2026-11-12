import { useState, type ReactNode } from "react";
import { BottomNavZen, type NavId } from "../core/components/BottomNavZen";
import { StreakBadge } from "../core/components/StreakBadge";
import { TimerStepperButton } from "../core/components/TimerStepperButton";
import { ZenPrimaryButton } from "../core/components/ZenPrimaryButton";
import type { ThemeId } from "../core/theme/colorTokens";
import {
  SunflowerStageWidget,
  sunflowerLabel,
} from "../features/dashboard/SunflowerStageWidget";
import "./gallery.css";

/** Texto unico que `galleryExcluded.build.test.ts` busca en el build de produccion. */
export const GALLERY_MARKER = "Galería de componentes (solo desarrollo)";

const THEME_LABELS: Record<ThemeId, string> = {
  light: "Komorebi (claro)",
  dark: "Tsukimi (oscuro)",
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="gallery-section">
      <h2 className="gallery-section__title">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="gallery-row">
      <span className="gallery-row__label">{label}</span>
      <div className="gallery-row__items">{children}</div>
    </div>
  );
}


const STAGE_SAMPLES: Array<{ name: string; percentage: number }> = [
  { name: "Semilla", percentage: 12 },
  { name: "Tallo", percentage: 45 },
  { name: "Capullo", percentage: 80 },
  { name: "Flor", percentage: 100 },
];

/** Porcentajes de borde: el cambio de etapa ocurre justo en 25, 60 y 100. */
const BOUNDARY_SAMPLES = [24.99, 25, 59.99, 60, 99.99, 100];

function Figure({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <figure className="gallery-figure">
      {children}
      <figcaption className="gallery-figure__caption">{caption}</figcaption>
    </figure>
  );
}

function SunflowerPlayground({ id }: { id: string }) {
  const [percentage, setPercentage] = useState(30);
  const [fallow, setFallow] = useState(false);
  const [solarBonus, setSolarBonus] = useState(false);
  const sliderId = `${id}-slider`;

  return (
    <div className="gallery-playground">
      <SunflowerStageWidget percentage={percentage} fallow={fallow} solarBonus={solarBonus} />
      <p className="gallery-playground__label">{sunflowerLabel(percentage, { fallow, solarBonus })}</p>
      <label className="gallery-playground__slider" htmlFor={sliderId}>
        <span>Progreso</span>
        <input
          id={sliderId}
          type="range"
          min={0}
          max={100}
          step={1}
          value={Math.floor(percentage)}
          onChange={(event) => setPercentage(Number(event.target.value))}
        />
        <output className="tabular">{percentage}%</output>
      </label>
      <div className="gallery-playground__chips">
        {BOUNDARY_SAMPLES.map((value) => (
          <button
            key={value}
            type="button"
            className="gallery-chip tabular"
            aria-pressed={percentage === value}
            onClick={() => setPercentage(value)}
          >
            {value}
          </button>
        ))}
      </div>
      <div className="gallery-playground__toggles">
        <label>
          <input type="checkbox" checked={fallow} onChange={(e) => setFallow(e.target.checked)} />{" "}
          En barbecho
        </label>
        <label>
          <input
            type="checkbox"
            checked={solarBonus}
            onChange={(e) => setSolarBonus(e.target.checked)}
          />{" "}
          Bono de Vitalidad Solar
        </label>
      </div>
    </div>
  );
}

function ThemePanel({ theme }: { theme: ThemeId }) {
  const [activeFixed, setActiveFixed] = useState<NavId>("lectura");
  const [activeScroll, setActiveScroll] = useState<NavId>("jardin");

  return (
    <div className="gallery-panel" data-theme={theme}>
      <h1 className="gallery-panel__title">{THEME_LABELS[theme]}</h1>

      <Section title="StreakBadge">
        <Row label="Sin racha, 1, 5 y 45">
          <StreakBadge days={0} />
          <StreakBadge days={1} />
          <StreakBadge days={5} />
          <StreakBadge days={45} />
        </Row>
      </Section>

      <Section title="ZenPrimaryButton (CTA)">
        <Row label="Normal">
          <ZenPrimaryButton>Comenzar Lectura</ZenPrimaryButton>
        </Row>
        <Row label="Presionado">
          <ZenPrimaryButton data-forced-state="pressed">Comenzar Lectura</ZenPrimaryButton>
        </Row>
        <Row label="Foco visible">
          <ZenPrimaryButton data-forced-state="focus">Comenzar Lectura</ZenPrimaryButton>
        </Row>
        <Row label="Deshabilitado">
          <ZenPrimaryButton disabled>Comenzar Lectura</ZenPrimaryButton>
        </Row>
      </Section>

      <Section title="ZenPrimaryButton (secundario)">
        <Row label="Normal">
          <ZenPrimaryButton variant="secondary">Por hoy no, volver al jardín</ZenPrimaryButton>
        </Row>
        <Row label="Presionado">
          <ZenPrimaryButton variant="secondary" data-forced-state="pressed">
            Cancelar
          </ZenPrimaryButton>
        </Row>
        <Row label="Foco visible">
          <ZenPrimaryButton variant="secondary" data-forced-state="focus">
            Cancelar
          </ZenPrimaryButton>
        </Row>
        <Row label="Deshabilitado">
          <ZenPrimaryButton variant="secondary" disabled>
            Cancelar
          </ZenPrimaryButton>
        </Row>
      </Section>

      <Section title="TimerStepperButton">
        <Row label="Normal">
          <TimerStepperButton direction="decrement" aria-label="Reducir tiempo" />
          <span className="gallery-timer tabular">15:00</span>
          <TimerStepperButton direction="increment" aria-label="Aumentar tiempo" />
        </Row>
        <Row label="Presionado">
          <TimerStepperButton
            direction="decrement"
            aria-label="Reducir tiempo"
            data-forced-state="pressed"
          />
          <TimerStepperButton
            direction="increment"
            aria-label="Aumentar tiempo"
            data-forced-state="pressed"
          />
        </Row>
        <Row label="Foco visible">
          <TimerStepperButton
            direction="decrement"
            aria-label="Reducir tiempo"
            data-forced-state="focus"
          />
          <TimerStepperButton
            direction="increment"
            aria-label="Aumentar tiempo"
            data-forced-state="focus"
          />
        </Row>
        <Row label="Deshabilitado">
          <TimerStepperButton direction="decrement" aria-label="Reducir tiempo" disabled />
          <TimerStepperButton direction="increment" aria-label="Aumentar tiempo" disabled />
        </Row>
      </Section>

      <Section title="SunflowerStageWidget (girasol)">
        <Row label="Las 4 etapas: 12, 45, 80 y 100 por ciento">
          {STAGE_SAMPLES.map(({ name, percentage }) => (
            <Figure key={name} caption={`${name} ${percentage}%`}>
              <SunflowerStageWidget percentage={percentage} size={72} />
            </Figure>
          ))}
        </Row>
        <Row label="En barbecho (45 y 80 por ciento) y la flor, que lo ignora">
          <SunflowerStageWidget percentage={45} fallow size={112} />
          <SunflowerStageWidget percentage={80} fallow size={112} />
          <SunflowerStageWidget percentage={100} fallow size={112} />
        </Row>
        <Row label="Bono de Vitalidad Solar (avance menor al 1 por ciento)">
          <SunflowerStageWidget percentage={12} solarBonus size={112} />
        </Row>
        <Row label="Miniatura de 48 px (tarjeta de Mi Jardín)">
          {STAGE_SAMPLES.map(({ name, percentage }) => (
            <SunflowerStageWidget key={name} percentage={percentage} mini />
          ))}
          <SunflowerStageWidget percentage={45} mini fallow />
        </Row>
        <Row label="Tamaño completo (220 px) con control de 0 a 100">
          <SunflowerPlayground id={`sunflower-${theme}`} />
        </Row>
      </Section>

      <Section title="BottomNavZen">
        <Row label="Vista fija (Papel Arroz). Usa Tab para ver el foco.">
          <div className="gallery-nav">
            <BottomNavZen active={activeFixed} onSelect={setActiveFixed} />
          </div>
        </Row>
        <Row label="Sobre lista con scroll (Lino Cálido)">
          <div className="gallery-nav">
            <BottomNavZen active={activeScroll} onSelect={setActiveScroll} surface="scroll" />
          </div>
        </Row>
        <Row label="Activo: Estadísticas">
          <div className="gallery-nav">
            <BottomNavZen active="estadisticas" onSelect={() => {}} showStats />
          </div>
        </Row>
      </Section>
    </div>
  );
}

export function Gallery() {
  return (
    <main className="gallery">
      <header className="gallery__header">
        <h1 className="gallery__title">{GALLERY_MARKER}</h1>
        <p className="gallery__note">
          Presionado y foco se fuerzan con data-forced-state. El área segura de iOS solo se ve en
          un iPhone o con el simulador.
        </p>
      </header>
      <div className="gallery__panels">
        <ThemePanel theme="light" />
        <ThemePanel theme="dark" />
      </div>
    </main>
  );
}
