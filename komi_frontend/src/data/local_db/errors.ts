// Errores del almacenamiento local. La interfaz decide el aviso segun `code`, sin analizar
// los errores de Dexie ni del navegador.

export type LocalErrorCode =
  | "storage_unavailable"
  | "storage_quota"
  | "book_not_found"
  | "invalid_book"
  | "invalid_profile"
  | "invalid_session"
  | "below_50_percent"
  | "book_fallow"
  | "book_bloomed"
  | "restore_other_profile";

export class KomiLocalError extends Error {
  readonly code: LocalErrorCode;
  readonly field: string | null;

  constructor(code: LocalErrorCode, message: string, field: string | null = null, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "KomiLocalError";
    this.code = code;
    this.field = field;
  }
}

/** IndexedDB no existe, esta bloqueado (modo privado, politicas) o no se pudo abrir. */
export class StorageUnavailableError extends KomiLocalError {
  constructor(cause?: unknown) {
    super(
      "storage_unavailable",
      "No se puede usar el almacenamiento del dispositivo. Revisa que el navegador permita guardar datos.",
      null,
      cause,
    );
    this.name = "StorageUnavailableError";
  }
}

/** El dispositivo no tiene espacio para guardar mas datos. */
export class StorageQuotaError extends KomiLocalError {
  constructor(cause?: unknown) {
    super(
      "storage_quota",
      "No hay espacio suficiente en el dispositivo. Libera espacio e intenta de nuevo.",
      null,
      cause,
    );
    this.name = "StorageQuotaError";
  }
}

export class BookNotFoundError extends KomiLocalError {
  constructor(bookId: string) {
    super("book_not_found", `No existe el libro ${bookId}.`, "book_id");
    this.name = "BookNotFoundError";
  }
}

export class InvalidBookError extends KomiLocalError {
  constructor(field: string, message: string) {
    super("invalid_book", message, field);
    this.name = "InvalidBookError";
  }
}

export class InvalidProfileError extends KomiLocalError {
  constructor(field: string, message: string) {
    super("invalid_profile", message, field);
    this.name = "InvalidProfileError";
  }
}

export class InvalidSessionError extends KomiLocalError {
  constructor(field: string, message: string, code: "invalid_session" | "below_50_percent" = "invalid_session") {
    super(code, message, field);
    this.name = "InvalidSessionError";
  }
}

/** El dispositivo ya tiene OTRO perfil: la recuperacion nunca mezcla ni reemplaza perfiles. */
export class RestoreProfileMismatchError extends KomiLocalError {
  constructor() {
    super("restore_other_profile", "Este dispositivo ya tiene otro perfil.", "profile_id");
    this.name = "RestoreProfileMismatchError";
  }
}

/** El libro no admite lecturas: esta en barbecho o ya florecio (como /sessions/complete/). */
export class SessionConflictError extends KomiLocalError {
  constructor(code: "book_fallow" | "book_bloomed", message: string) {
    super(code, message, "book_id");
    this.name = "SessionConflictError";
  }
}
