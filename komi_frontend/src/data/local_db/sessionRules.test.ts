import { describe, expect, it } from "vitest";
import { uuid } from "../../test/db";
import { InvalidSessionError, SessionConflictError } from "./errors";
import {
  evaluateSession,
  formatLocalWallClock,
  grantsSolarBonus,
  validateSessionInput,
  type CompleteSessionInput,
} from "./sessionRules";
import type { LocalBook } from "./types";

function book(overrides: Partial<LocalBook> = {}): LocalBook {
  return {
    id: uuid(1),
    title: "Kokoro",
    author: "Natsume Soseki",
    format_type: "PHYSICAL",
    sunflower_variant: "CLASSIC",
    status: "ACTIVE",
    total_pages: 264,
    current_page: 0,
    progress_percentage: 0,
    last_epub_cfi: null,
    created_at: "2026-11-05T10:00:00.000Z",
    completed_at: null,
    updated_at: "2026-11-05T10:00:00.000Z",
    pending_sync: 0,
    ...overrides,
  };
}

function input(overrides: Partial<CompleteSessionInput> = {}): CompleteSessionInput {
  return {
    id: uuid(100),
    book_id: uuid(1),
    planned_duration_sec: 900,
    actual_duration_sec: 900,
    started_at_local: "2026-11-05T21:30:00",
    session_status: "COMPLETED",
    current_page: 30,
    ...overrides,
  };
}

describe("formatLocalWallClock", () => {
  it("usa los getters locales, no UTC (una lectura a las 23:50 sigue en el mismo dia)", () => {
    const source = {
      getFullYear: () => 2026,
      getMonth: () => 10,
      getDate: () => 5,
      getHours: () => 23,
      getMinutes: () => 50,
      getSeconds: () => 7,
      // Si alguien usara toISOString, veria un instante distinto y de otro dia.
      toISOString: () => "2026-11-06T04:50:07.000Z",
    };
    expect(formatLocalWallClock(source)).toBe("2026-11-05T23:50:07");
  });

  it("rellena con ceros", () => {
    const source = {
      getFullYear: () => 2026,
      getMonth: () => 0,
      getDate: () => 2,
      getHours: () => 3,
      getMinutes: () => 4,
      getSeconds: () => 5,
    };
    expect(formatLocalWallClock(source)).toBe("2026-01-02T03:04:05");
  });
});

describe("validateSessionInput", () => {
  it("acepta una sesion valida", () => {
    expect(() => validateSessionInput(input())).not.toThrow();
  });

  it.each([
    ["id", { id: "no-es-uuid" }],
    ["book_id", { book_id: "123" }],
    ["planned_duration_sec", { planned_duration_sec: 299 }],
    ["planned_duration_sec", { planned_duration_sec: 7201 }],
    ["planned_duration_sec", { planned_duration_sec: 900.5 }],
    ["actual_duration_sec", { actual_duration_sec: -1 }],
    ["actual_duration_sec", { actual_duration_sec: 901 }],
    ["started_at_local", { started_at_local: "2026-11-05T21:30:00Z" }],
    ["started_at_local", { started_at_local: "2026-11-05T21:30:00-05:00" }],
    ["started_at_local", { started_at_local: "2026-11-05" }],
    ["current_page", { current_page: -2 }],
    ["current_page", { current_page: 1.5 }],
    ["progress_percentage", { progress_percentage: 100.01 }],
    ["progress_percentage", { progress_percentage: Number.NaN }],
    ["last_epub_cfi", { last_epub_cfi: "x".repeat(2001) }],
    ["extracted_epub_excerpt", { extracted_epub_excerpt: "x".repeat(20_001) }],
  ] as Array<[string, Partial<CompleteSessionInput>]>)("rechaza %s invalido", (field, patch) => {
    try {
      validateSessionInput(input(patch));
      expect.unreachable("deberia haber lanzado");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidSessionError);
      expect((error as InvalidSessionError).field).toBe(field);
    }
  });

  it("acepta la hora local con fracciones de segundo", () => {
    expect(() =>
      validateSessionInput(input({ started_at_local: "2026-11-05T21:30:00.123456" })),
    ).not.toThrow();
  });

  it("acepta los limites exactos de duracion", () => {
    expect(() =>
      validateSessionInput(input({ planned_duration_sec: 300, actual_duration_sec: 300 })),
    ).not.toThrow();
    expect(() =>
      validateSessionInput(input({ planned_duration_sec: 7200, actual_duration_sec: 0 })),
    ).not.toThrow();
  });
});

describe("evaluateSession: libro fisico", () => {
  it("calcula el avance truncado a partir de la pagina", () => {
    const outcome = evaluateSession(book(), input({ current_page: 100 }));
    expect(outcome.newProgressHundredths).toBe(3787); // 100/264 = 37.878...
    expect(outcome.newPage).toBe(100);
    expect(outcome.deltaHundredths).toBe(3787);
    expect(outcome.valid).toBe(true);
  });

  it("una lectura que retrocede no baja ni el progreso ni la pagina", () => {
    const current = book({ current_page: 120, progress_percentage: 45.45 });
    const outcome = evaluateSession(current, input({ current_page: 100 }));
    expect(outcome.newProgressHundredths).toBe(4545);
    expect(outcome.newPage).toBe(120);
    expect(outcome.deltaHundredths).toBe(0);
  });

  it("exige la pagina y que no supere el total", () => {
    expect(() => evaluateSession(book(), input({ current_page: undefined }))).toThrow(
      InvalidSessionError,
    );
    expect(() => evaluateSession(book(), input({ current_page: 265 }))).toThrow(InvalidSessionError);
    expect(() => evaluateSession(book({ total_pages: null }), input())).toThrow(InvalidSessionError);
  });

  it("llegar a la ultima pagina florece el libro", () => {
    const outcome = evaluateSession(book({ current_page: 200, progress_percentage: 75.75 }), input({ current_page: 264 }));
    expect(outcome.newProgressHundredths).toBe(10_000);
    expect(outcome.justBloomed).toBe(true);
  });
});

describe("evaluateSession: EPUB", () => {
  const epub = (overrides: Partial<LocalBook> = {}) =>
    book({ format_type: "EPUB", total_pages: null, ...overrides });

  it("usa el porcentaje informado, truncado", () => {
    const outcome = evaluateSession(
      epub(),
      input({ current_page: undefined, progress_percentage: 12.349, last_epub_cfi: "cfi-1" }),
    );
    expect(outcome.newProgressHundredths).toBe(1234);
    expect(outcome.reportedProgress).toBe(12.34);
    expect(outcome.updateCfi).toBe(true);
  });

  it("el CFI solo avanza si la lectura no retrocedio", () => {
    const current = epub({ progress_percentage: 50, last_epub_cfi: "cfi-50" });
    const back = evaluateSession(
      current,
      input({ current_page: undefined, progress_percentage: 40, last_epub_cfi: "cfi-40" }),
    );
    expect(back.updateCfi).toBe(false);
    expect(back.newProgressHundredths).toBe(5000);

    const same = evaluateSession(
      current,
      input({ current_page: undefined, progress_percentage: 50, last_epub_cfi: "cfi-50b" }),
    );
    expect(same.updateCfi).toBe(true);
  });

  it("un CFI vacio o ausente no se aplica", () => {
    expect(
      evaluateSession(epub(), input({ current_page: undefined, progress_percentage: 10 })).updateCfi,
    ).toBe(false);
    expect(
      evaluateSession(
        epub(),
        input({ current_page: undefined, progress_percentage: 10, last_epub_cfi: "" }),
      ).updateCfi,
    ).toBe(false);
  });

  it("exige el porcentaje", () => {
    expect(() => evaluateSession(epub(), input({ current_page: undefined }))).toThrow(
      InvalidSessionError,
    );
  });
});

describe("evaluateSession: una sola regla de duracion (FA-3.3)", () => {
  const advance = { current_page: 30 };
  // Un temporizador de 60 min: el tiempo programado ya no decide la validez.
  const hour = { planned_duration_sec: 3600 };
  const code = (run: () => unknown) => {
    try {
      run();
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidSessionError);
      return (error as InvalidSessionError).code;
    }
  };

  it("tiempo completo es COMPLETED aunque el cliente diga otra cosa", () => {
    const outcome = evaluateSession(book(), input({ ...advance, session_status: "EARLY_VALID" }));
    expect(outcome.status).toBe("COMPLETED");
  });

  it("4:59 se rechaza con duration_out_of_range", () => {
    const run = () => evaluateSession(book(), input({ ...advance, ...hour, actual_duration_sec: 299 }));
    expect(code(run)).toBe("duration_out_of_range");
  });

  it("5:00 exactos se aceptan y quedan COMPLETED", () => {
    const outcome = evaluateSession(book(), input({ ...advance, ...hour, actual_duration_sec: 300 }));
    expect(outcome.status).toBe("COMPLETED");
    expect(outcome.valid).toBe(true);
  });

  it("120:00 exactos se aceptan", () => {
    const outcome = evaluateSession(
      book(),
      input({ ...advance, planned_duration_sec: 7200, actual_duration_sec: 7200 }),
    );
    expect(outcome.status).toBe("COMPLETED");
  });

  it("mas de 120 minutos se rechaza (la validacion estructural, antes de evaluar)", () => {
    const longer = { planned_duration_sec: 7201, actual_duration_sec: 7201 };
    expect(code(() => validateSessionInput(input({ ...advance, ...longer })))).toBe(
      "duration_out_of_range",
    );
    const over = { planned_duration_sec: 7200, actual_duration_sec: 7201 };
    expect(() => validateSessionInput(input({ ...advance, ...over }))).toThrow(InvalidSessionError);
  });

  it("un temporizador cortado a los 6 minutos de 60 vale: ya no hay regla del 50 %", () => {
    const outcome = evaluateSession(book(), input({ ...advance, ...hour, actual_duration_sec: 360 }));
    expect(outcome.status).toBe("COMPLETED");
  });

  it("una sesion corta que lleva el libro al 100 % vale (planned = max(actual, 300))", () => {
    const nearEnd = book({ current_page: 250, progress_percentage: 94.69 });
    const short = { planned_duration_sec: 300, actual_duration_sec: 60 };
    const outcome = evaluateSession(nearEnd, input({ current_page: 264, ...short }));
    expect(outcome.status).toBe("COMPLETED");
    expect(outcome.justBloomed).toBe(true);
  });

  it("una sesion corta que no llega al 100 % no vale, ni a una pagina del final", () => {
    const nearEnd = book({ current_page: 250, progress_percentage: 94.69 });
    const short = { planned_duration_sec: 300, actual_duration_sec: 60 };
    expect(code(() => evaluateSession(nearEnd, input({ current_page: 263, ...short })))).toBe(
      "duration_out_of_range",
    );
  });

  it("un libro que ya estaba al 100 % no reabre la excepcion", () => {
    const done = book({ status: "BLOOMED", progress_percentage: 100, current_page: 264 });
    const short = { planned_duration_sec: 300, actual_duration_sec: 60, current_page: 264 };
    expect(() => evaluateSession(done, input(short), { acceptInactiveBook: true })).toThrow(
      InvalidSessionError,
    );
  });

  it("planned fuera de 5 a 120 minutos usa el mismo codigo que el servidor", () => {
    for (const planned of [299, 7201]) {
      expect(
        code(() => validateSessionInput(input({ planned_duration_sec: planned, actual_duration_sec: 0 }))),
      ).toBe("duration_out_of_range");
    }
  });
});

describe("evaluateSession: sesion invalidada y conflictos", () => {
  it("la invalidada (gracia vencida) no toca progreso, pagina ni CFI", () => {
    const current = book({ current_page: 120, progress_percentage: 45.45 });
    const outcome = evaluateSession(
      current,
      input({ session_status: "INVALIDATED_GRACE_EXPIRED", actual_duration_sec: 3, current_page: 200 }),
    );
    expect(outcome.valid).toBe(false);
    expect(outcome.status).toBe("INVALIDATED_GRACE_EXPIRED");
    expect(outcome.newProgressHundredths).toBe(4545);
    expect(outcome.newPage).toBe(120);
    expect(outcome.deltaHundredths).toBe(0);
    expect(outcome.grantedSolarBonus).toBe(false);
    expect(outcome.updateCfi).toBe(false);
  });

  it("un libro en barbecho no admite lecturas validas", () => {
    expect(() => evaluateSession(book({ status: "FALLOW" }), input())).toThrow(SessionConflictError);
  });

  it("un libro florecido no admite lecturas validas", () => {
    const bloomed = book({ status: "BLOOMED", progress_percentage: 100, current_page: 264 });
    expect(() => evaluateSession(bloomed, input())).toThrow(SessionConflictError);
  });

  it("pero una sesion invalidada se registra aunque el libro este en barbecho", () => {
    const outcome = evaluateSession(
      book({ status: "FALLOW" }),
      input({ session_status: "INVALIDATED_GRACE_EXPIRED", actual_duration_sec: 2 }),
    );
    expect(outcome.valid).toBe(false);
  });
});

describe("grantsSolarBonus (SRS 16, punto 4)", () => {
  it("solo fisico, sesion valida y avance en [0, 1)", () => {
    expect(grantsSolarBonus("PHYSICAL", 0, true)).toBe(true); // 0 califica
    expect(grantsSolarBonus("PHYSICAL", 99, true)).toBe(true); // 0.99
    expect(grantsSolarBonus("PHYSICAL", 100, true)).toBe(false); // 1.00 no
    expect(grantsSolarBonus("PHYSICAL", -1, true)).toBe(false);
    expect(grantsSolarBonus("EPUB", 50, true)).toBe(false);
    expect(grantsSolarBonus("PHYSICAL", 50, false)).toBe(false);
  });

  it("una lectura fisica de menos de un punto lo otorga; una de mas no", () => {
    const current = book({ current_page: 100, progress_percentage: 37.87 });
    expect(evaluateSession(current, input({ current_page: 102 })).grantedSolarBonus).toBe(true); // +0.76
    expect(evaluateSession(current, input({ current_page: 104 })).grantedSolarBonus).toBe(false); // +1.51
  });
});
