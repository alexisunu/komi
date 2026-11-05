// Registros locales (IndexedDB). Los nombres y tipos de campo coinciden con el lote de
// POST /api/v1/profile/sync/ (SyncBookSerializer y SessionPayloadSerializer del backend).
// Sin campos opcionales con `undefined`: lo ausente es `null`.

export type FormatType = "EPUB" | "PHYSICAL";
export type SunflowerVariant = "CLASSIC" | "SOLAR" | "AUTUMN";
export type BookStatus = "ACTIVE" | "GROWING" | "BLOOMED" | "FALLOW";
export type SessionStatus = "COMPLETED" | "EARLY_VALID" | "INVALIDATED_GRACE_EXPIRED";
export type ThemeMode = "light" | "dark";
export type PreferredMoment = "MORNING" | "AFTERNOON" | "NIGHT" | "COMMUTE";
export type AiReflectionStyle = "MEMORY_QUIZ" | "DEEP_ANALYSIS" | "KEY_SUMMARY";

/** IndexedDB no indexa booleanos: la marca de pendiente de sync es 0 o 1. */
export type PendingFlag = 0 | 1;

export interface LocalBook {
  /** UUID generado en el cliente; es tambien el id definitivo en el servidor. */
  id: string;
  title: string;
  author: string;
  format_type: FormatType;
  sunflower_variant: SunflowerVariant;
  status: BookStatus;
  /** Solo libros fisicos (1 a 100000); null en EPUB. */
  total_pages: number | null;
  current_page: number;
  /** 0 a 100 con 2 decimales como maximo, truncado (nunca redondeado). Monotonico. */
  progress_percentage: number;
  last_epub_cfi: string | null;
  created_at: string;
  completed_at: string | null;
  /** Instante real en ISO 8601 UTC. Solo cambia cuando algo cambia de verdad (SRS 11.4). */
  updated_at: string;
  pending_sync: PendingFlag;
}

export interface LocalSession {
  /** UUID del cliente: base de la sincronizacion aditiva e idempotente. */
  id: string;
  book_id: string;
  planned_duration_sec: number;
  actual_duration_sec: number;
  /** Hora de pared local SIN zona, p. ej. "2026-11-05T23:50:00" (SRS 16, punto 1). */
  started_at_local: string;
  session_status: SessionStatus;
  /** Libro fisico: pagina alcanzada segun el lector. Null en EPUB y en sesiones invalidadas. */
  current_page: number | null;
  /** EPUB: porcentaje informado (truncado). Null en fisico y en sesiones invalidadas. */
  progress_percentage: number | null;
  last_epub_cfi: string | null;
  /** Se anula al sincronizar: el servidor ya la tiene y el texto ocupa espacio local. */
  extracted_epub_excerpt: string | null;
  /** Calculados localmente para la interfaz; el servidor los recalcula y no se envian. */
  progress_delta: number;
  granted_solar_bonus: boolean;
  pending_sync: PendingFlag;
}

/** Fila unica (id "local"): perfil del lector y ajustes locales. */
export interface LocalProfile {
  id: "local";
  profile_id: string;
  daily_goal_minutes: number;
  preferred_moment: PreferredMoment;
  ai_reflection_style: AiReflectionStyle;
  /** Eleccion manual del tema (interruptor de Ajustes); null = sin eleccion. */
  theme_mode: ThemeMode | null;
  preconfigure_tsukimi: boolean | null;
  /** Falso mientras el POST /profile/onboarding/ siga en cola (SRS 18, punto 11). */
  onboarding_synced: boolean;
  created_at: string;
  updated_at: string;
}

export interface MetaEntry {
  key: string;
  value: string | number | boolean | null;
}
