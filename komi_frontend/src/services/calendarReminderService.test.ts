import { describe, expect, it, vi } from "vitest";
import type { PreferredMoment } from "../data/local_db/types";
import {
  buildReminderIcs,
  downloadReminderIcs,
  escapeIcsText,
  foldLine,
  REMINDER_TIMES,
} from "./calendarReminderService";

const UID = "123e4567-e89b-12d3-a456-426614174000";
const base = {
  moment: "MORNING" as PreferredMoment,
  durationMinutes: 15,
  startDate: new Date(2026, 10, 5, 22, 10), // 5 nov 2026, hora local
  now: new Date(Date.UTC(2026, 10, 5, 12, 5, 9)),
  uid: UID,
};
const octets = (s: string) => new TextEncoder().encode(s).length;

describe("buildReminderIcs", () => {
  const ics = buildReminderIcs(base);

  it("todas las lineas terminan en CRLF y no hay LF sueltos", () => {
    expect(ics.endsWith("\r\n")).toBe(true);
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
  });

  it("tiene la estructura de calendario y evento", () => {
    const lines = ics.split("\r\n");
    expect(lines[0]).toBe("BEGIN:VCALENDAR");
    expect(lines).toContain("VERSION:2.0");
    expect(lines).toContain("BEGIN:VEVENT");
    expect(lines).toContain("END:VEVENT");
    expect(lines).toContain("RRULE:FREQ=DAILY");
    expect(lines).toContain("DURATION:PT15M");
    expect(lines[lines.length - 2]).toBe("END:VCALENDAR");
  });

  it("UID y DTSTAMP validos", () => {
    expect(ics).toContain(`\r\nUID:${UID}@komi\r\n`);
    expect(ics).toContain("\r\nDTSTAMP:20261105T120509Z\r\n");
  });

  it("genera un UID nuevo por defecto", () => {
    const { uid: _omit, ...withoutUid } = base;
    void _omit;
    const a = buildReminderIcs(withoutUid);
    const b = buildReminderIcs(withoutUid);
    const uidOf = (t: string) => /UID:(.+)@komi/.exec(t)?.[1];
    expect(uidOf(a)).toMatch(/^[0-9a-f-]{36}$/);
    expect(uidOf(a)).not.toBe(uidOf(b));
  });

  it.each([
    ["MORNING", "20261105T073000"],
    ["AFTERNOON", "20261105T150000"],
    ["NIGHT", "20261105T213000"],
    ["COMMUTE", "20261105T123000"],
  ] as const)("%s usa hora local sin zona %s", (moment, stamp) => {
    const text = buildReminderIcs({ ...base, moment });
    expect(text).toContain(`\r\nDTSTART:${stamp}\r\n`);
    expect(text).not.toMatch(/DTSTART[^\r]*Z/);
    expect(text).not.toContain("TZID");
  });

  it("la tabla de horas coincide con el SRS", () => {
    expect(REMINDER_TIMES).toEqual({
      MORNING: { hour: 7, minute: 30 },
      AFTERNOON: { hour: 15, minute: 0 },
      NIGHT: { hour: 21, minute: 30 },
      COMMUTE: { hour: 12, minute: 30 },
    });
  });

  it("la fecha de inicio usa el dia local, no el UTC", () => {
    const late = buildReminderIcs({ ...base, startDate: new Date(2026, 10, 5, 23, 50) });
    expect(late).toContain("DTSTART:20261105T073000");
  });

  it("ninguna linea fisica supera 75 octetos y no hay emojis", () => {
    for (const moment of Object.keys(REMINDER_TIMES) as PreferredMoment[]) {
      const text = buildReminderIcs({ ...base, moment, durationMinutes: 45 });
      for (const line of text.split("\r\n")) expect(octets(line)).toBeLessThanOrEqual(75);
      expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });

  it("rechaza entradas invalidas", () => {
    expect(() => buildReminderIcs({ ...base, durationMinutes: 0 })).toThrow(RangeError);
    expect(() => buildReminderIcs({ ...base, durationMinutes: 1.5 })).toThrow(RangeError);
    expect(() => buildReminderIcs({ ...base, now: new Date("x") })).toThrow(RangeError);
    expect(() => buildReminderIcs({ ...base, startDate: new Date("x") })).toThrow(RangeError);
    expect(() => buildReminderIcs({ ...base, uid: "a\r\nBEGIN:VEVENT" })).toThrow(RangeError);
  });
});

describe("escapeIcsText", () => {
  it("escapa barra, punto y coma, coma y saltos de linea", () => {
    expect(escapeIcsText("a\\b;c,d\ne\r\nf")).toBe("a\\\\b\\;c\\,d\\ne\\nf");
  });

  it("elimina emojis y caracteres de control", () => {
    expect(escapeIcsText("Leer \u{1F33B} hoy\u0000")).toBe("Leer  hoy");
    expect(escapeIcsText("\u{1F468}‍\u{1F469}x")).toBe("x");
  });

  it("conserva acentos y tabuladores", () => {
    expect(escapeIcsText("Lectura\ten calma, sí")).toBe("Lectura\ten calma\\, sí");
  });

  it("el evento generado escapa la coma de la descripcion", () => {
    expect(buildReminderIcs(base)).toContain("minutos\\, sin prisa");
  });
});

describe("foldLine", () => {
  it("no toca lineas de hasta 75 octetos", () => {
    const line = "X".repeat(75);
    expect(foldLine(line)).toBe(line);
  });

  it("parte a los 75 octetos y continua con un espacio (74 de contenido)", () => {
    expect(foldLine("X".repeat(76)).split("\r\n")).toEqual(["X".repeat(75), " X"]);
    const long = foldLine("Y".repeat(75 + 74 * 2 + 1)).split("\r\n");
    expect(long.map(octets)).toEqual([75, 75, 75, 2]);
  });

  it("no parte caracteres multibyte y desplegar devuelve el original", () => {
    const original = "DESCRIPTION:" + "áéíóúñ".repeat(30);
    const folded = foldLine(original);
    for (const part of folded.split("\r\n")) expect(octets(part)).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, "")).toBe(original);
    expect(folded).not.toContain("�");
  });

  it("un caracter de 3 octetos que no cabe pasa a la linea siguiente", () => {
    const original = "X".repeat(74) + "€"; // 74 + 3 = 77 octetos
    expect(foldLine(original).split("\r\n")).toEqual(["X".repeat(74), " €"]);
  });
});

describe("downloadReminderIcs", () => {
  it("crea un Blob text/calendar y dispara la descarga", () => {
    const create = vi.fn<(blob: Blob) => string>(() => "blob:komi");
    const revoke = vi.fn();
    vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    downloadReminderIcs("BEGIN:VCALENDAR\r\n");
    expect(create.mock.calls[0]?.[0].type).toBe("text/calendar;charset=utf-8");
    expect(click).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledWith("blob:komi");
    click.mockRestore();
    vi.unstubAllGlobals();
  });
});
