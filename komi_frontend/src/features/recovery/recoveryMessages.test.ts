import { describe, expect, it } from "vitest";
import {
  FAILED_MESSAGE,
  NOT_FOUND_MESSAGE,
  OTHER_ACCOUNT_MESSAGE,
  restoreFailureMessage,
  restoreSummary,
  STORAGE_MESSAGE,
  UNAVAILABLE_MESSAGE,
} from "./recoveryMessages";

const report = (over = {}) => ({
  profileCreated: false,
  booksAdded: 0,
  booksAdvanced: 0,
  sessionsAdded: 0,
  chatsAdded: 0,
  ...over,
});

describe("restoreFailureMessage", () => {
  it("cada resultado tiene su aviso, y ninguno nombra el codigo", () => {
    expect(restoreFailureMessage({ kind: "not_found" })).toBe(NOT_FOUND_MESSAGE);
    expect(restoreFailureMessage({ kind: "other_account" })).toBe(OTHER_ACCOUNT_MESSAGE);
    expect(restoreFailureMessage({ kind: "unavailable" })).toBe(UNAVAILABLE_MESSAGE);
    expect(restoreFailureMessage({ kind: "storage" })).toBe(STORAGE_MESSAGE);
    expect(restoreFailureMessage({ kind: "failed" })).toBe(FAILED_MESSAGE);
    const all = new Set([NOT_FOUND_MESSAGE, OTHER_ACCOUNT_MESSAGE, UNAVAILABLE_MESSAGE, STORAGE_MESSAGE, FAILED_MESSAGE]);
    expect(all.size).toBe(5);
  });
});

describe("restoreSummary", () => {
  it("sin nada nuevo dice que ya esta al dia", () => {
    expect(restoreSummary(report())).toBe("Tus datos ya están al día en este dispositivo.");
  });

  it("cuenta en singular y en plural", () => {
    expect(restoreSummary(report({ booksAdded: 1 }))).toBe("Recuperamos 1 libro.");
    expect(restoreSummary(report({ booksAdded: 2, sessionsAdded: 1, chatsAdded: 3 }))).toBe(
      "Recuperamos 2 libros, 1 sesión y 3 charlas.",
    );
    expect(restoreSummary(report({ sessionsAdded: 4, chatsAdded: 1 }))).toBe("Recuperamos 4 sesiones y 1 charla.");
  });

  it("si solo subio el avance de libros lo dice", () => {
    expect(restoreSummary(report({ booksAdvanced: 1 }))).toBe("Actualizamos el avance de 1 libro.");
    expect(restoreSummary(report({ booksAdvanced: 3 }))).toBe("Actualizamos el avance de 3 libros.");
  });

  it("une lo recuperado con el avance actualizado", () => {
    expect(restoreSummary(report({ sessionsAdded: 2, booksAdvanced: 1 }))).toBe(
      "Recuperamos 2 sesiones. Actualizamos el avance de 1 libro.",
    );
  });
});
