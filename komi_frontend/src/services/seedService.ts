// Semillas del Dia (SRS 10.3): la frase que Komi extrae al cerrar una charla, agrupada por libro.
// Se lee solo de Dexie (sin red). La fecha sale de la hora LOCAL guardada de la sesion
// (`started_at_local`), nunca de un instante UTC: una lectura de las 23:50 es de ese dia.

import type { LocalReflectionRepository } from "../data/local_db/localReflectionRepository";
import type { LocalSessionRepository } from "../data/local_db/localSessionRepository";

export interface Seed {
  chatId: string;
  bookId: string;
  text: string;
  /** Hora de pared local sin zona, p. ej. "2026-11-05T23:50:00". */
  startedAtLocal: string;
  /** Fecha larga en espanol, p. ej. "5 de noviembre de 2026". */
  dateLabel: string;
}

const MONTHS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

const LOCAL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})/;

/** "2026-11-05T23:50:00" -> "5 de noviembre de 2026", sin pasar por Date ni por zonas horarias. */
export function longDateEs(local: string): string {
  const match = LOCAL_PATTERN.exec(local);
  if (!match) return "";
  const month = MONTHS[Number(match[2]) - 1];
  if (!month) return "";
  return `${Number(match[3])} de ${month} de ${match[1]}`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Respaldo si la sesion ya no esta: el instante guardado se pasa a la hora de pared del dispositivo. */
function localFromInstant(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

export interface SeedServiceDeps {
  reflections: Pick<LocalReflectionRepository, "listSeeds">;
  sessions: Pick<LocalSessionRepository, "getSession">;
}

export function createSeedService({ reflections, sessions }: SeedServiceDeps) {
  return {
    /** Todas las semillas por libro, de la mas reciente a la mas antigua. */
    async loadByBook(): Promise<Map<string, Seed[]>> {
      const rows = await reflections.listSeeds();
      const seeds: Seed[] = [];
      for (const row of rows) {
        if (row.key_takeaway === null) continue;
        const session = await sessions.getSession(row.session_id).catch(() => undefined);
        const startedAtLocal = session?.started_at_local ?? localFromInstant(row.updated_at);
        seeds.push({
          chatId: row.chat_id,
          bookId: row.book_id,
          text: row.key_takeaway,
          startedAtLocal,
          dateLabel: longDateEs(startedAtLocal),
        });
      }
      seeds.sort((a, b) => (a.startedAtLocal < b.startedAtLocal ? 1 : a.startedAtLocal > b.startedAtLocal ? -1 : 0));
      const byBook = new Map<string, Seed[]>();
      for (const seed of seeds) {
        const list = byBook.get(seed.bookId);
        if (list) list.push(seed);
        else byBook.set(seed.bookId, [seed]);
      }
      return byBook;
    },
  };
}

export type SeedService = ReturnType<typeof createSeedService>;

/** "1 semilla" / "3 semillas". */
export function seedCountLabel(count: number): string {
  return count === 1 ? "1 semilla" : `${count} semillas`;
}
