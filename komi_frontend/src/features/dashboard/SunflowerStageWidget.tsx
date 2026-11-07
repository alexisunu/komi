// Lienzo del girasol (SRS 10.2). Variante clasica, 4 etapas y estado "En barbecho". La silueta y
// los textos siguen docs/reference_prototype.tsx; la logica no: la etapa sale de botanicCalculator
// (sin umbrales propios) y los colores salen solo de las variables CSS del tema (SunflowerStage
// Widget.css), por eso el SVG no lleva colores en sus atributos.
//
// Sin animacion continua salvo el balanceo y la respiracion del girasol durante la sesion (prop
// `breathing`, CU-03 paso 4): solo transform, por capas como en el prototipo (la planta se mece
// desde la base del tallo; la cabeza respira con otro ciclo y desfase). Se pausa con
// `breathingPaused` y se anula con prefers-reduced-motion. Aparte hay un fundido de 350 ms entre
// etapas.

import type { ReactElement } from "react";
import {
  stageForProgress,
  stageNumber,
  wholePercent,
  type GrowthStage,
} from "../../services/botanicCalculator";
import "./SunflowerStageWidget.css";

/** Nombres de etapa del prototipo. */
export const STAGE_NAMES: Record<GrowthStage, string> = {
  SEED_1: "Semilla",
  STEM_2: "Tallo",
  BUD_3: "Capullo",
  BLOOM_4: "Flor",
};

/** Etapas en el orden en que se dibujan. */
const STAGES: GrowthStage[] = ["SEED_1", "STEM_2", "BUD_3", "BLOOM_4"];

/** Una flor completa nunca se ve latente: un libro en barbecho que llega al 100% florece. */
export function isDormant(percentage: number, fallow: boolean): boolean {
  return fallow && stageForProgress(percentage) !== "BLOOM_4";
}

/** Etiqueta accesible: "Girasol en etapa Tallo, 33 por ciento" (o "en barbecho, etapa ..."). */
export function sunflowerLabel(
  percentage: number,
  options: { fallow?: boolean; solarBonus?: boolean } = {},
): string {
  const stage = STAGE_NAMES[stageForProgress(percentage)];
  const dormant = isDormant(percentage, options.fallow ?? false);
  const base = dormant ? `Girasol en barbecho, etapa ${stage}` : `Girasol en etapa ${stage}`;
  const bonus = options.solarBonus ? ", con Bono de Vitalidad Solar" : "";
  return `${base}, ${wholePercent(percentage)} por ciento${bonus}`;
}

export interface SunflowerStageWidgetProps {
  /** Progreso del libro, de 0 a 100 (se trunca a 2 decimales). */
  percentage: number;
  /** Libro en barbecho (archivado). Se ignora al llegar a la flor completa. */
  fallow?: boolean;
  /** Bono de Vitalidad Solar (SRS FA-4.1): aura alrededor del girasol. */
  solarBonus?: boolean;
  /** Lado en px. Por defecto 220 (SRS 10.2), o 48 con `mini` (SRS 10.3). */
  size?: number;
  /** Miniatura de tarjeta: sin halo, aura ni particulas. */
  mini?: boolean;
  /** Balanceo y respiracion suaves durante la sesion (CU-03): solo `transform`. */
  breathing?: boolean;
  /** Pausa la respiracion (la pagina esta en segundo plano). */
  breathingPaused?: boolean;
}

const PETAL_COUNT = 12;
const PETAL_PATH = "M 110 42 C 118 42, 121 58, 110 70 C 99 58, 102 42, 110 42 Z";
const PETAL_ANGLES = Array.from({ length: PETAL_COUNT }, (_, i) => (360 / PETAL_COUNT) * i);

function Stem({ d, width }: { d: string; width: number }) {
  return <path className="sf-stem" d={d} fill="none" strokeWidth={width} strokeLinecap="round" />;
}

function Leaf({ d }: { d: string }) {
  return <path className="sf-leaf" d={d} />;
}

function SeedStage() {
  return (
    <>
      <Stem d="M 110 176 Q 110 156 110 144" width={3} />
      <Leaf d="M 110 152 C 94 146, 90 134, 104 136 C 108 137, 110 145, 110 152 Z" />
      <Leaf d="M 110 152 C 126 146, 130 134, 116 136 C 112 137, 110 145, 110 152 Z" />
      <ellipse className="sf-seed" cx="110" cy="168" rx="5" ry="7" />
    </>
  );
}

function StemStage() {
  return (
    <>
      <Stem d="M 110 176 Q 108 138 110 102" width={3.5} />
      <Leaf d="M 109 152 C 82 148, 76 128, 96 128 C 104 128, 108 142, 109 152 Z" />
      <Leaf d="M 110 142 C 136 138, 142 118, 122 118 C 114 118, 111 132, 110 142 Z" />
      <Leaf d="M 110 104 C 102 92, 110 84, 110 84 C 110 84, 118 92, 110 104 Z" />
    </>
  );
}

function BudStage() {
  return (
    <>
      <Stem d="M 110 176 Q 107 130 110 86" width={4} />
      <Leaf d="M 109 154 C 78 150, 72 128, 94 128 C 103 128, 108 144, 109 154 Z" />
      <Leaf d="M 110 144 C 140 140, 146 118, 124 118 C 115 118, 111 134, 110 144 Z" />
      <Leaf d="M 109 120 C 84 114, 82 98, 98 100 C 105 101, 108 112, 109 120 Z" />
      <g className="sf-head">
        <path className="sf-petal-outer" d="M 102 74 L 105 60 L 110 70 L 115 58 L 118 74 Z" />
        <path className="sf-leaf" d="M 96 84 C 96 68, 124 68, 124 84 C 124 92, 96 92, 96 84 Z" />
      </g>
    </>
  );
}

function BloomStage() {
  return (
    <>
      <Stem d="M 110 176 Q 107 128 110 82" width={4.2} />
      <Leaf d="M 109 154 C 74 148, 68 124, 92 124 C 102 124, 108 142, 109 154 Z" />
      <Leaf d="M 110 142 C 144 136, 150 112, 126 112 C 116 112, 111 130, 110 142 Z" />
      <g className="sf-head">
        {PETAL_ANGLES.map((angle, i) => (
          <path
            key={angle}
            className={i % 2 === 0 ? "sf-petal-outer" : "sf-petal-inner"}
            d={PETAL_PATH}
            transform={`rotate(${angle} 110 78)`}
          />
        ))}
        <circle className="sf-center" cx="110" cy="78" r="17" />
        <circle className="sf-ring" cx="110" cy="78" r="12" fill="none" strokeDasharray="2 3" />
        <circle className="sf-dot" cx="106" cy="74" r="1.3" />
        <circle className="sf-dot" cx="114" cy="74" r="1.3" />
        <circle className="sf-dot" cx="110" cy="78" r="1.3" />
        <circle className="sf-dot" cx="105" cy="82" r="1.3" />
        <circle className="sf-dot" cx="115" cy="82" r="1.3" />
      </g>
    </>
  );
}

const STAGE_DRAWINGS: Record<GrowthStage, () => ReactElement> = {
  SEED_1: SeedStage,
  STEM_2: StemStage,
  BUD_3: BudStage,
  BLOOM_4: BloomStage,
};

export function SunflowerStageWidget({
  percentage,
  fallow = false,
  solarBonus = false,
  size,
  mini = false,
  breathing = false,
  breathingPaused = false,
}: SunflowerStageWidgetProps) {
  const stage = stageForProgress(percentage);
  const dormant = isDormant(percentage, fallow);
  const side = size ?? (mini ? 48 : 220);

  const classes = ["sunflower"];
  if (dormant) classes.push("sunflower--fallow");
  if (solarBonus && !mini) classes.push("sunflower--bonus");
  if (breathing && !mini) classes.push("sunflower--breathing");
  if (breathing && !mini && breathingPaused) classes.push("sunflower--breathing-paused");

  return (
    <div
      className={classes.join(" ")}
      role="img"
      aria-label={sunflowerLabel(percentage, { fallow, solarBonus })}
      data-stage={stageNumber(stage)}
      data-fallow={dormant ? "true" : "false"}
      style={{ width: side, height: side }}
    >
      {!mini && <div className="sunflower__halo" aria-hidden="true" />}

      <svg className="sunflower__svg" viewBox="0 0 220 220" aria-hidden="true" focusable="false">
        {solarBonus && !mini && (
          <g className="sf-aura" data-testid="solar-aura">
            <circle className="sf-aura__glow" cx="110" cy="110" r="100" />
            <circle className="sf-aura__ring" cx="110" cy="110" r="86" fill="none" strokeDasharray="4 6" />
            <circle className="sf-aura__dot" cx="48" cy="78" r="3.5" />
            <circle className="sf-aura__dot" cx="172" cy="74" r="3" />
            <circle className="sf-aura__dot" cx="110" cy="26" r="4" />
          </g>
        )}

        {stage === "BLOOM_4" && !mini && (
          <g className="sf-sparkles" data-testid="bloom-sparkles">
            <circle className="sf-sparkle-primary" cx="52" cy="58" r="2.5" />
            <circle className="sf-sparkle-primary" cx="168" cy="64" r="3.5" />
            <circle className="sf-sparkle-secondary" cx="155" cy="115" r="2" />
            <circle className="sf-sparkle-primary" cx="62" cy="122" r="2.2" />
          </g>
        )}

        {/* La planta (sin el suelo) es lo que se mece; la semilla solo respira. */}
        <g className="sf-plant" data-motion={stage === "SEED_1" ? "seed" : "sway"}>
          {STAGES.map((name) => {
            const Drawing = STAGE_DRAWINGS[name];
            return (
              <g
                key={name}
                className="sunflower__stage"
                data-stage-name={name}
                data-active={name === stage ? "true" : "false"}
              >
                <Drawing />
              </g>
            );
          })}
        </g>

        <path className="sf-soil" d="M 72 182 Q 110 166 148 182 Z" />
        <path className="sf-soil-line" d="M 64 182 L 156 182" />
      </svg>
    </div>
  );
}
