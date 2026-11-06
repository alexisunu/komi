// Mensajes cuando no se puede abrir la charla con Komi. Los comparten la hoja post-lectura y la
// pantalla de la charla. El codigo del rechazo del servidor NO aparece aqui: va solo al registro.

export type GateBlock = "offline" | "unsynced" | "rejected";

export const GATE_MESSAGES: Record<GateBlock, string> = {
  offline: "No hay conexión con el servidor. Tu lectura sigue guardada; inténtalo cuando vuelva.",
  unsynced: "No pudimos sincronizar tu sesión ahora. Tu lectura sigue guardada en este dispositivo.",
  rejected:
    "El servidor no pudo validar esta sesión, así que no podemos abrir la charla. Tu lectura sigue guardada en este dispositivo.",
};

/** Un rechazo permanente no se arregla reintentando. */
export function canRetryGate(block: GateBlock): boolean {
  return block !== "rejected";
}
