// Recordatorio de lectura en formato iCalendar (RFC 5545) para Apple Calendar y Google Calendar.
// SRS 18, punto 10: 07:30 (MORNING), 15:00 (AFTERNOON), 21:30 (NIGHT) y 12:30 (COMMUTE).
// Las horas son locales y sin zona (DTSTART "flotante"): el recordatorio suena a la misma hora de
// pared aunque el lector viaje. La descarga en una PWA instalada de iOS se valida en la Fase 5.

import type { PreferredMoment } from "../data/local_db/types";

export const REMINDER_TIMES: Record<PreferredMoment, { hour: number; minute: number }> = {
  MORNING: { hour: 7, minute: 30 },
  AFTERNOON: { hour: 15, minute: 0 },
  NIGHT: { hour: 21, minute: 30 },
  COMMUTE: { hour: 12, minute: 30 },
};

const CRLF = "\r\n";
/** RFC 5545 3.1: ninguna linea supera los 75 octetos, sin contar el salto de linea. */
const MAX_LINE_OCTETS = 75;

const UID_TOKEN = /^[A-Za-z0-9-]+$/;
// Unir de ancho cero (ZWJ) y selector de variacion 16, que acompanan a los emojis.
const INVISIBLE_JOINERS = new RegExp(`${String.fromCharCode(0x200d)}|${String.fromCharCode(0xfe0f)}`, "g");
const encoder = new TextEncoder();

export interface ReminderOptions {
  moment: PreferredMoment;
  /** Duracion del bloque en minutos (la meta diaria). */
  durationMinutes: number;
  /** Fecha del primer recordatorio (hora local). */
  startDate: Date;
  /** Instante de creacion, para DTSTAMP (UTC). */
  now: Date;
  /** Identificador unico del evento; por defecto un UUID nuevo. */
  uid?: string;
}

/** Escapa un valor TEXT (RFC 5545 3.3.11) y descarta emojis y caracteres de control. */
export function escapeIcsText(value: string): string {
  return (
    value
      .replace(/\p{Extended_Pictographic}|\p{Emoji_Modifier}/gu, "")
      .replace(INVISIBLE_JOINERS, "")
      .replace(/\r\n|\r/g, "\n")
      // Controles salvo tabulador (\u0009) y salto de linea (\u000A), que se escapa despues.
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "")
      .replace(/\\/g, "\\\\")
      .replace(/;/g, "\\;")
      .replace(/,/g, "\\,")
      .replace(/\n/g, "\\n")
  );
}

/** Pliega una linea a 75 octetos UTF-8 sin partir caracteres; las continuaciones llevan un espacio. */
export function foldLine(line: string): string {
  const parts: string[] = [];
  let current = "";
  let currentOctets = 0;
  // La primera linea admite 75 octetos; las siguientes 74 mas el espacio inicial.
  let limit = MAX_LINE_OCTETS;
  for (const char of line) {
    const octets = encoder.encode(char).length;
    if (currentOctets + octets > limit) {
      parts.push(current);
      current = "";
      currentOctets = 0;
      limit = MAX_LINE_OCTETS - 1;
    }
    current += char;
    currentOctets += octets;
  }
  parts.push(current);
  return parts.join(CRLF + " ");
}

const two = (n: number) => String(n).padStart(2, "0");

/** Fecha y hora local sin zona: 20261105T073000. */
function formatLocal(date: Date, hour: number, minute: number): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  return `${year}${two(date.getMonth() + 1)}${two(date.getDate())}T${two(hour)}${two(minute)}00`;
}

/** Instante en UTC: 20261105T123000Z. */
function formatUtc(date: Date): string {
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const day = `${year}${two(date.getUTCMonth() + 1)}${two(date.getUTCDate())}`;
  return `${day}T${two(date.getUTCHours())}${two(date.getUTCMinutes())}${two(date.getUTCSeconds())}Z`;
}

function assertValidDate(date: Date, name: string): void {
  if (Number.isNaN(date.getTime())) throw new RangeError(`${name} no es una fecha valida.`);
}

/** Genera el texto del .ics: un evento diario con alarma al inicio. Lineas terminadas en CRLF. */
export function buildReminderIcs(options: ReminderOptions): string {
  const { moment, durationMinutes, startDate, now } = options;
  assertValidDate(startDate, "startDate");
  assertValidDate(now, "now");
  if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440) {
    throw new RangeError("La duracion debe ser un entero de 1 a 1440 minutos.");
  }
  const time = REMINDER_TIMES[moment];
  const uid = options.uid ?? crypto.randomUUID();
  if (!UID_TOKEN.test(uid)) throw new RangeError("El UID solo admite letras, numeros y guiones.");

  const summary = escapeIcsText("Hora de leer con Komi");
  const description = escapeIcsText(
    `Tu momento de lectura: ${durationMinutes} minutos, sin prisa. Tu girasol te espera.`,
  );

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Komi//Recordatorio de lectura//ES",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${uid}@komi`,
    `DTSTAMP:${formatUtc(now)}`,
    `DTSTART:${formatLocal(startDate, time.hour, time.minute)}`,
    `DURATION:PT${durationMinutes}M`,
    "RRULE:FREQ=DAILY",
    `SUMMARY:${summary}`,
    `DESCRIPTION:${description}`,
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "TRIGGER:PT0M",
    `DESCRIPTION:${summary}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(foldLine).join(CRLF) + CRLF;
}

export const REMINDER_FILENAME = "komi-recordatorio.ics";

/** Descarga el .ics como archivo. Es la unica parte que toca el DOM. */
export function downloadReminderIcs(ics: string, filename: string = REMINDER_FILENAME): void {
  const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
