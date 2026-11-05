// Aritmetica de progreso. El servidor trunca a 2 decimales con ROUND_DOWN para que el 100% solo
// se alcance en la ultima pagina (apps/reading_sessions/services.py). Aqui se trabaja en
// centesimas enteras para evitar errores de coma flotante.

export const FULL_HUNDREDTHS = 10_000;

/** Convierte un porcentaje con 2 decimales a centesimas enteras (33.33 -> 3333). */
export function toHundredths(percentage: number): number {
  return Math.round(percentage * 100);
}

export function fromHundredths(hundredths: number): number {
  return hundredths / 100;
}

/**
 * Porcentaje de un libro fisico en centesimas, TRUNCADO. Con redondeo, la pagina 99.996 de 100
 * marcaria 100% sin haber terminado el libro.
 */
export function pageProgressHundredths(page: number, totalPages: number): number {
  return Math.floor((page * FULL_HUNDREDTHS) / totalPages);
}

/** Trunca un porcentaje informado a 2 decimales, limitado a 0..100. */
export function truncateProgress(percentage: number): number {
  // toPrecision(12) elimina el ruido binario (0.29 * 100 = 28.999999999999996) antes de truncar.
  const hundredths = Math.trunc(Number((percentage * 100).toPrecision(12)));
  return fromHundredths(Math.min(Math.max(hundredths, 0), FULL_HUNDREDTHS));
}
