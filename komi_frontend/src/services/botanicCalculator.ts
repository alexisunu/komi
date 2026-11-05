// Etapa del girasol y Bono de Vitalidad Solar. La etapa replica stage_for_progress
// (apps/garden/models.py): 0-24 semilla, 25-59 tallo, 60-99 capullo, 100 flor (CLAUDE.md 6).
// Se trabaja en centesimas enteras con el mismo truncado a 2 decimales que el servidor, de modo
// que 24.999 sigue siendo semilla y 99.999 sigue siendo capullo (nunca se redondea hacia arriba).

import {
  FULL_HUNDREDTHS,
  toHundredths,
  truncateProgress,
} from "../data/local_db/progressMath";
import { grantsSolarBonus } from "../data/local_db/sessionRules";
import type { FormatType } from "../data/local_db/types";

/** Mismos valores que GrowthStage del backend. */
export type GrowthStage = "SEED_1" | "STEM_2" | "BUD_3" | "BLOOM_4";

export const STEM_FROM_HUNDREDTHS = 2_500;
export const BUD_FROM_HUNDREDTHS = 6_000;

/** Etapa para un porcentaje. Fuera de 0..100 se acota y un valor no finito cuenta como 0. */
export function stageForProgress(percentage: number): GrowthStage {
  const hundredths = Number.isFinite(percentage) ? toHundredths(truncateProgress(percentage)) : 0;
  if (hundredths >= FULL_HUNDREDTHS) return "BLOOM_4";
  if (hundredths >= BUD_FROM_HUNDREDTHS) return "BUD_3";
  if (hundredths >= STEM_FROM_HUNDREDTHS) return "STEM_2";
  return "SEED_1";
}

/**
 * Porcentaje entero para mostrar: truncado, nunca redondeado (99.99 -> 99), para que "100" solo
 * aparezca al llegar de verdad al 100%. Un valor no finito cuenta como 0.
 */
export function wholePercent(percentage: number): number {
  return Number.isFinite(percentage) ? Math.floor(truncateProgress(percentage)) : 0;
}

/** Numero de etapa (1 a 4) para la interfaz. */
export function stageNumber(stage: GrowthStage): 1 | 2 | 3 | 4 {
  return { SEED_1: 1, STEM_2: 2, BUD_3: 3, BLOOM_4: 4 }[stage] as 1 | 2 | 3 | 4;
}

export interface GrowthInput {
  format: FormatType;
  /** Progreso guardado antes de la sesion (0 a 100). */
  previousProgress: number;
  /** Progreso informado en la sesion (0 a 100). El progreso es monotonico: nunca baja. */
  newProgress: number;
  /** Sesion valida (COMPLETED o EARLY_VALID). */
  valid: boolean;
}

export interface GrowthResult {
  stage: GrowthStage;
  progress: number;
  /** Avance en puntos porcentuales, con 2 decimales. */
  delta: number;
  justBloomed: boolean;
  grantedSolarBonus: boolean;
}

export function evaluateGrowth(input: GrowthInput): GrowthResult {
  const previous = toHundredths(truncateProgress(input.previousProgress));
  const reported = toHundredths(truncateProgress(input.newProgress));
  const current = Math.max(previous, reported);
  const delta = current - previous;
  return {
    stage: stageForProgress(current / 100),
    progress: current / 100,
    delta: delta / 100,
    justBloomed: current >= FULL_HUNDREDTHS && previous < FULL_HUNDREDTHS,
    grantedSolarBonus: grantsSolarBonus(input.format, delta, input.valid),
  };
}
