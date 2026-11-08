// Textos de la recuperacion de datos (Fase 5.3), compartidos por el onboarding y Ajustes.
// Los avisos de error son genericos a proposito: un codigo mal escrito y un codigo que no existe
// dicen lo mismo, para no revelar que codigos son validos.

import type { RestoreReport } from "../../data/local_db/localRestore";
import type { RestoreOutcome } from "../../data/network/restoreService";

export type RestoreFailure = Exclude<RestoreOutcome, { kind: "restored" }>;

export const NOT_FOUND_MESSAGE = "No encontramos ese código. Revísalo e inténtalo de nuevo.";
export const OTHER_ACCOUNT_MESSAGE =
  "Este dispositivo ya tiene otra cuenta. Por seguridad no la mezclamos ni la reemplazamos.";
export const UNAVAILABLE_MESSAGE = "No pudimos conectar con Komi. Revisa tu conexión e inténtalo de nuevo.";
export const STORAGE_MESSAGE =
  "No pudimos guardar tus datos en este dispositivo. Revisa que el navegador permita guardar datos y que haya espacio.";
export const FAILED_MESSAGE = "No pudimos recuperar tus datos. Inténtalo de nuevo en unos minutos.";
export const EPUB_NOTE =
  "Los archivos .epub no se guardan en nuestros servidores: para leer esos libros tendrás que volver a elegirlos.";

export function restoreFailureMessage(outcome: RestoreFailure): string {
  switch (outcome.kind) {
    case "not_found":
      return NOT_FOUND_MESSAGE;
    case "other_account":
      return OTHER_ACCOUNT_MESSAGE;
    case "unavailable":
      return UNAVAILABLE_MESSAGE;
    case "storage":
      return STORAGE_MESSAGE;
    case "failed":
      return FAILED_MESSAGE;
  }
}

const count = (n: number, one: string, many: string): string | null => (n === 0 ? null : `${n} ${n === 1 ? one : many}`);

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
}

/** Que se agrego en esta recuperacion, en una frase. */
export function restoreSummary(report: RestoreReport): string {
  const added = [
    count(report.booksAdded, "libro", "libros"),
    count(report.sessionsAdded, "sesión", "sesiones"),
    count(report.chatsAdded, "charla", "charlas"),
  ].filter((item): item is string => item !== null);
  const advanced = count(report.booksAdvanced, "libro", "libros");

  if (added.length === 0 && advanced === null) return "Tus datos ya están al día en este dispositivo.";
  if (added.length === 0) return `Actualizamos el avance de ${advanced}.`;
  const first = `Recuperamos ${joinList(added)}.`;
  return advanced === null ? first : `${first} Actualizamos el avance de ${advanced}.`;
}
