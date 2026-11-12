// Banderas de funcionalidad de la v2 (SRS 20). Un solo lugar: cambiar el valor aqui enciende o apaga la
// funcion en toda la app, sin tocar los componentes.

export interface FeatureFlags {
  /**
   * Racha (badge del Dashboard) y pestana "Estadisticas". Apagada en la v2 por decision del autor: el
   * codigo, el calculo de la racha y los datos se conservan; solo se ocultan.
   */
  readonly statsAndStreak: boolean;
}

export const FEATURES: FeatureFlags = { statsAndStreak: false };
