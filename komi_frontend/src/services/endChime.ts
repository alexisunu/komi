// Sonido de fin de tiempo del libro fisico con temporizador (v2, docs/V2_Diseno_Lector.md).
//
// Se sintetiza con la Web Audio API: sin archivo, sin licencia, sin red y sin tocar el precache de
// Workbox. Dos notas senoidales suaves (Do5 y Mi5) con ataque corto y caida exponencial.
//
// Safari en iPhone bloquea el audio sin un gesto del usuario: `unlock()` se llama DENTRO del toque
// de "Comenzar lectura" (antes de cualquier `await`), crea el contexto, lo reanuda y reproduce un
// instante de silencio; `play()` lo reutiliza despues. Con `navigator.audioSession.type =
// "playback"` (Audio Session API de Safari) el sonido suena aunque el interruptor de silencio este
// activo. Nada de esto puede romper la sesion: cualquier fallo se traga y `play()` devuelve false.
// El aviso visual "El tiempo termino" (hoja de cierre) no depende de este servicio.

/**
 * Volumen pico de cada nota (0 a 1). Es la unica perilla del volumen: en un telefono real puede
 * quedar bajo; subirlo aqui (por ejemplo a 0,3) basta.
 */
export const CHIME_PEAK_GAIN = 0.18;

/** Ataque de cada nota, en segundos (evita el "clic" del arranque brusco). */
const ATTACK_S = 0.02;
/** Valor casi cero para la rampa exponencial (no admite cero exacto). */
const SILENCE = 0.0001;

/** Do5 y Mi5; la segunda nota entra antes de que acabe la primera. Tiempos en segundos. */
export const CHIME_NOTES: ReadonlyArray<{ hz: number; startS: number; durationS: number }> = [
  { hz: 523.25, startS: 0, durationS: 1.1 },
  { hz: 659.25, startS: 0.28, durationS: 1.3 },
];

type AudioContextCtor = new () => AudioContext;

export interface EndChimeEnv {
  /** Constructor de `AudioContext` (o `webkitAudioContext`); `undefined` si el navegador no lo tiene. */
  audioContext: AudioContextCtor | undefined;
  /** Para fijar `audioSession.type`; en navegadores sin la API no hay nada que fijar. */
  navigator: { audioSession?: { type: string } };
  /** El sonido solo es fiable con la app en primer plano. */
  isVisible: () => boolean;
}

export interface EndChimeService {
  /** Prepara el audio. Llamar DENTRO de un gesto del usuario, antes de cualquier `await`. */
  unlock(): void;
  /** Reproduce el carillon. `true` si quedo programado; `false` si no se pudo (bloqueado, oculto, sin API). */
  play(): boolean;
}

function defaultEnv(): EndChimeEnv {
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return {
    audioContext: w.AudioContext ?? w.webkitAudioContext,
    navigator: navigator as unknown as EndChimeEnv["navigator"],
    isVisible: () => document.visibilityState === "visible",
  };
}

export function createEndChimeService(env: EndChimeEnv = defaultEnv()): EndChimeService {
  let context: AudioContext | null = null;

  return {
    unlock() {
      try {
        if (env.navigator.audioSession) env.navigator.audioSession.type = "playback";
      } catch {
        // Sin Audio Session API (o de solo lectura): se sigue sin ella.
      }
      try {
        if (!env.audioContext) return;
        // Un contexto cerrado ya no sirve (el navegador lo libero): se crea otro.
        if (!context || context.state === "closed") context = new env.audioContext();
        void context.resume().catch(() => {});
        // Un instante de silencio por el mismo gesto: Safari da por activado el audio.
        const source = context.createBufferSource();
        source.buffer = context.createBuffer(1, 1, 22050);
        source.connect(context.destination);
        source.start(0);
      } catch {
        // Audio no disponible: el aviso visual cubre el fin de tiempo.
      }
    },

    play() {
      try {
        const ctx = context;
        if (!ctx || ctx.state !== "running" || !env.isVisible()) return false;
        const now = ctx.currentTime;
        for (const note of CHIME_NOTES) {
          const start = now + note.startS;
          const end = start + note.durationS;
          const oscillator = ctx.createOscillator();
          oscillator.type = "sine";
          oscillator.frequency.value = note.hz;
          const gain = ctx.createGain();
          gain.gain.setValueAtTime(SILENCE, start);
          gain.gain.linearRampToValueAtTime(CHIME_PEAK_GAIN, start + ATTACK_S);
          gain.gain.exponentialRampToValueAtTime(SILENCE, end);
          oscillator.connect(gain);
          gain.connect(ctx.destination);
          oscillator.start(start);
          oscillator.stop(end + 0.05);
        }
        return true;
      } catch {
        return false;
      }
    },
  };
}
