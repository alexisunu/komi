// Pantalla de la charla (bloque 7): servicio, Dexie y cliente HTTP reales; servidor SSE falso.

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KomiDatabase } from "../../data/local_db/dexieDatabase";
import { createLocalReflectionRepository } from "../../data/local_db/localReflectionRepository";
import type { LocalBook } from "../../data/local_db/types";
import { createApiClient } from "../../data/network/apiClient";
import { createCompanionClient } from "../../data/network/companionClient";
import { createReloadGate, type ReloadGate } from "../../pwa/reloadGate";
import { createCompanionService } from "../../services/companionService";
import type { SessionGate } from "../../data/network/syncService";
import { createFakeServer, deferred, type FakeServer } from "../../test/fakeCompanionServer";
import { createTestDb, fakeClock, uuid } from "../../test/db";
import { render } from "../../test/render";
import { CompanionChatScreen } from "./CompanionChatScreen";

const PROFILE = uuid(77);
const SESSION = uuid(10);
const BOOK: LocalBook = {
  id: uuid(1),
  title: "Kokoro",
  author: "Natsume Soseki",
  format_type: "PHYSICAL",
  sunflower_variant: "CLASSIC",
  status: "ACTIVE",
  total_pages: 264,
  current_page: 87,
  progress_percentage: 33,
  last_epub_cfi: null,
  created_at: "2026-11-01T00:00:00.000Z",
  completed_at: null,
  updated_at: "2026-11-01T00:00:00.000Z",
  pending_sync: 0,
};

let db: KomiDatabase;
let server: FakeServer;
let gate: ReloadGate;
let reload: ReturnType<typeof vi.fn<() => void>>;
let mounted: ReturnType<typeof render> | null = null;
let gateState: SessionGate;
const onLeave = vi.fn();
const flush = vi.fn(async () => {});

beforeEach(() => {
  db = createTestDb();
  server = createFakeServer({ profileId: PROFILE });
  server.knowSession(SESSION);
  gateState = { state: "ready" };
  reload = vi.fn<() => void>();
  gate = createReloadGate(reload);
  onLeave.mockClear();
  flush.mockClear();
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  db.close();
  vi.useRealTimers();
});

function makeService() {
  const api = createApiClient({
    baseUrl: "https://api.komi.test",
    fetchFn: server.fetchFn,
    getProfileId: () => PROFILE,
  });
  return createCompanionService({
    client: createCompanionClient(api),
    sync: { sessionGate: async (): Promise<SessionGate> => gateState, flush },
    reflections: createLocalReflectionRepository(db, fakeClock()),
    wait: async () => {},
  });
}

// Espera por turnos de tarea, no por milisegundos de reloj: Dexie (fake-indexeddb) y el servidor SSE
// falso avanzan un paso por turno, asi que cuantos turnos hacen falta no depende de la velocidad de la
// maquina. Se consideran asentados cuando la pantalla y el numero de peticiones llevan TURNS_STABLE
// turnos seguidos sin cambiar. No usa setTimeout: sigue valiendo con relojes simulados.
const TURNS_STABLE = 25;
const MAX_TURNS = 4000;
const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve));
const fingerprint = () =>
  `${document.body.innerHTML}|${server.messageCalls().length}|${server.startCalls().length}|${server.pendingReplies()}`;

async function drain(minTurns = TURNS_STABLE) {
  await act(async () => {
    let last = fingerprint();
    let stable = 0;
    for (let turn = 0; turn < MAX_TURNS && stable < minTurns; turn += 1) {
      await nextTurn();
      const now = fingerprint();
      stable = now === last ? stable + 1 : 0;
      last = now;
    }
  });
}

/** Mismo papel que antes ("dejar que pase lo pendiente"), sin depender de milisegundos. */
const settle = () => drain();

/** Espera, por turnos, a que se cumpla una condicion (para saber que algo ya ocurrio antes de seguir). */
async function until(condition: () => boolean) {
  await act(async () => {
    for (let turn = 0; turn < MAX_TURNS && !condition(); turn += 1) await nextTurn();
  });
  expect(condition()).toBe(true);
}

async function tap(el: Element | null | undefined) {
  if (!el) throw new Error("Elemento no encontrado");
  await act(async () => {
    (el as HTMLElement).click();
  });
  await drain();
}
const root = () => mounted?.container as HTMLElement;
const button = (text: string) =>
  [...document.querySelectorAll("button")].find((b) => b.textContent?.trim().startsWith(text)) as
    | HTMLButtonElement
    | undefined;
const field = () => document.querySelector("textarea") as HTMLTextAreaElement;
const text = () => document.body.textContent ?? "";
const bubbles = () => [...document.querySelectorAll(".companion__bubble")].map((b) => b.textContent);

async function type(value: string) {
  const area = field();
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(area, value);
    area.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function mountChat() {
  mounted = render(
    <CompanionChatScreen service={makeService()} gate={gate} sessionId={SESSION} book={BOOK} onLeave={onLeave} />,
  );
  await settle();
}

async function say(message: string, ...replies: Parameters<FakeServer["reply"]>) {
  server.reply(...replies);
  await type(message);
  await tap(button("Enviar") ?? button("Reintentar"));
  await settle();
}

const NOTICE =
  "Komi usa Gemini, de Google. Tu texto se envía a Google y personas pueden leerlo. Evita datos sensibles.";
const notice = () => document.querySelector('[data-testid="gemini-notice"]');

describe("aviso de Gemini (SRS 19.24, bloque 5.5)", () => {
  it("con la charla abierta se ve el texto exacto bajo el campo y antes del boton Enviar", async () => {
    await mountChat();
    expect(notice()?.textContent).toBe(NOTICE);
    const position = field().compareDocumentPosition(notice() as Node);
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const afterNotice = (notice() as Node).compareDocumentPosition(button("Enviar") as Node);
    expect(afterNotice & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("el campo lo referencia con aria-describedby", async () => {
    await mountChat();
    const id = notice()?.id;
    expect(id).toBeTruthy();
    expect(field().getAttribute("aria-describedby")?.split(" ")).toContain(id);
  });

  it("al aparecer el contador, el campo sigue referenciando el aviso y suma el contador", async () => {
    await mountChat();
    await type("a".repeat(1800));
    const ids = field().getAttribute("aria-describedby")?.split(" ") ?? [];
    expect(ids).toContain(notice()?.id);
    expect(ids).toHaveLength(2);
    expect(document.getElementById(ids.find((id) => id !== notice()?.id) ?? "")?.textContent).toContain(
      "1800 de",
    );
  });

  it("sigue visible mientras se envia y se responde, y despues", async () => {
    await mountChat();
    const hold = deferred();
    server.reply({ kind: "ok", chunks: ["Hola, ", "te leo."], seed: null, hold });
    await type("Hola");
    await tap(button("Enviar"));
    await settle();
    expect(field().disabled).toBe(true); // se esta enviando
    expect((notice() as HTMLElement).hidden).toBe(false);
    expect(notice()?.textContent).toBe(NOTICE);
    hold.resolve();
    await settle();
    expect(field().disabled).toBe(false);
    expect((notice() as HTMLElement).hidden).toBe(false);
  });

  it("no se ve sin conexion, sin sincronizar ni con la sesion rechazada", async () => {
    for (const state of [{ state: "offline" }, { state: "unsynced" }, { state: "rejected", code: "x" }] as const) {
      gateState = state;
      await mountChat();
      expect(notice()).toBeNull();
      mounted?.unmount();
      mounted = null;
    }
  });

  it("no se ve con la charla cerrada", async () => {
    await mountChat();
    for (let i = 1; i <= 4; i += 1) await say(`m${i}`, { kind: "ok", chunks: ["Ok"], seed: "Semilla" });
    expect(notice()).toBeNull();
  });

  it("no se ve mientras se abre la charla", async () => {
    const hold = deferred();
    server.fetchFn.mockImplementationOnce(async () => {
      await hold.promise;
      return new Response("{}", { status: 500 });
    });
    await mountChat();
    expect(text()).toContain("Conectando con Komi");
    expect(notice()).toBeNull();
    hold.resolve();
  });

  it("no agrega bloques funcionales", async () => {
    await mountChat();
    expect(root().querySelectorAll("[data-block]")).toHaveLength(3);
  });

  it("el texto no menciona entrenamiento de modelos", () => {
    expect(NOTICE.toLowerCase()).not.toContain("entren");
  });
});

describe("apertura", () => {
  it("muestra el libro, el contador y la apertura de Komi", async () => {
    await mountChat();
    expect(text()).toContain("Kokoro");
    expect(text()).toContain("Natsume Soseki");
    expect(root().querySelector('[data-testid="zen-cycle"]')?.textContent).toBe("Ciclo Zen: Turno 1 de 5");
    expect(bubbles()).toHaveLength(1);
    expect(bubbles()[0]).toContain("soy Komi");
    expect(button("Enviar")?.disabled).toBe(true);
  });

  it("usa como maximo 4 bloques funcionales", async () => {
    await mountChat();
    expect(root().querySelectorAll("[data-block]").length).toBeLessThanOrEqual(4);
  });

  it("mientras abre dice que conecta y no bloquea la recarga", async () => {
    gateState = { state: "ready" };
    const hold = deferred();
    server.fetchFn.mockImplementationOnce(async () => {
      await hold.promise;
      return new Response("{}", { status: 500 });
    });
    mounted = render(
      <CompanionChatScreen service={makeService()} gate={gate} sessionId={SESSION} book={BOOK} onLeave={onLeave} />,
    );
    await settle();
    expect(text()).toContain("Conectando con Komi");
    expect(gate.isBlocked()).toBe(false);
    hold.resolve();
  });

  it("si el servidor esta arrancando dice 'Despertando a Komi' en lugar de 'Conectando'", async () => {
    gateState = { state: "ready" };
    const hold = deferred();
    server.fetchFn.mockImplementationOnce(async () => {
      await hold.promise;
      return new Response("{}", { status: 500 });
    });
    mounted = render(
      <CompanionChatScreen
        service={makeService()}
        gate={gate}
        waking
        sessionId={SESSION}
        book={BOOK}
        onLeave={onLeave}
      />,
    );
    await settle();
    expect(text()).toContain("Despertando a Komi");
    expect(text()).not.toContain("Conectando con Komi");
    expect(gate.isBlocked()).toBe(false);
    hold.resolve();
  });

  it("al enviar con el servidor dormido, 'Despertando a Komi' sustituye a 'Komi esta escribiendo'", async () => {
    const hold = deferred();
    let wakeNow = false;
    const api = createApiClient({
      baseUrl: "https://api.komi.test",
      fetchFn: server.fetchFn,
      getProfileId: () => PROFILE,
    });
    const service = createCompanionService({
      client: createCompanionClient(api),
      sync: { sessionGate: async (): Promise<SessionGate> => gateState, flush },
      wake: { ensureAwake: async () => (wakeNow ? (await hold.promise, true) : true) },
      reflections: createLocalReflectionRepository(db, fakeClock()),
      wait: async () => {},
    });
    const view = (waking: boolean) => (
      <CompanionChatScreen
        service={service}
        gate={gate}
        waking={waking}
        sessionId={SESSION}
        book={BOOK}
        onLeave={onLeave}
      />
    );
    mounted = render(view(false));
    await settle();
    wakeNow = true;
    server.reply({ kind: "ok", chunks: ["Hola"] });
    await type("Me gusto");
    await tap(button("Enviar"));
    expect(document.querySelector('[data-testid="typing"]')?.textContent).toContain("Komi está escribiendo");
    mounted.rerender(view(true));
    await settle();
    expect(document.querySelector('[data-testid="typing"]')?.textContent).toContain("Despertando a Komi");
    expect(document.querySelector('[data-testid="typing"]')?.textContent).not.toContain("escribiendo");
    expect(server.messageCalls()).toHaveLength(0);
    hold.resolve();
    await settle();
    expect(server.messageCalls()).toHaveLength(1);
  });

  it("sin la sesion en el servidor: mensaje de FA-5.2 con salida al jardin", async () => {
    gateState = { state: "offline" };
    await mountChat();
    expect(text()).toContain("No hay conexión con el servidor");
    expect(text()).not.toContain("no pudo validar");
    expect(button("Reintentar")).toBeDefined();
    expect(field()).toBeNull();
    expect(server.startCalls()).toHaveLength(0);
    await tap(button("Volver al jardín"));
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it("no se pudo sincronizar ahora: mensaje propio (no culpa a internet) y con Reintentar", async () => {
    gateState = { state: "unsynced" };
    await mountChat();
    expect(text()).toContain("No pudimos sincronizar tu sesión ahora");
    expect(text()).not.toContain("No hay conexión");
    expect(button("Reintentar")).toBeDefined();
    expect(server.startCalls()).toHaveLength(0);
    gateState = { state: "ready" };
    await tap(button("Reintentar"));
    await settle();
    expect(field()).not.toBeNull();
  });

  it("sesion no validada por el servidor: mensaje claro, sin Reintentar y sin el codigo en pantalla", async () => {
    gateState = { state: "rejected", code: "below_50_percent" };
    await mountChat();
    expect(text()).toContain("El servidor no pudo validar esta sesión");
    expect(text()).not.toContain("below_50_percent");
    expect(button("Reintentar")).toBeUndefined();
    expect(field()).toBeNull();
    expect(server.startCalls()).toHaveLength(0);
    await tap(button("Volver al jardín"));
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it("Reintentar tras estar sin conexion abre la charla cuando vuelve la red", async () => {
    gateState = { state: "offline" };
    await mountChat();
    gateState = { state: "ready" };
    await tap(button("Reintentar"));
    await settle();
    expect(root().querySelector('[data-testid="zen-cycle"]')?.textContent).toBe("Ciclo Zen: Turno 1 de 5");
    expect(field()).not.toBeNull();
  });

  it("404 persistente: mensaje claro y solo la salida segura", async () => {
    server.chats.clear();
    mounted = render(
      <CompanionChatScreen
        service={makeService()}
        gate={gate}
        sessionId={uuid(55)}
        book={BOOK}
        onLeave={onLeave}
      />,
    );
    await settle();
    expect(text()).toContain("todavía no llegó al servidor");
    expect(button("Reintentar")).toBeUndefined();
    expect(flush).toHaveBeenCalledTimes(1);
    await tap(button("Volver al jardín"));
    expect(onLeave).toHaveBeenCalled();
  });

  it("409 session_invalid: mensaje claro y salida segura", async () => {
    server.invalidateSession(SESSION);
    await mountChat();
    expect(text()).toContain("no cuenta para la charla con Komi");
    expect(button("Reintentar")).toBeUndefined();
  });

  it("un fallo del servidor al abrir ofrece Reintentar", async () => {
    server.fetchFn.mockResolvedValueOnce(new Response("{}", { status: 503 }));
    await mountChat();
    expect(text()).toContain("No pudimos abrir la charla");
    await tap(button("Reintentar"));
    await settle();
    expect(field()).not.toBeNull();
  });
});

describe("conversar", () => {
  it("envia, muestra el indicador hasta el primer fragmento y luego el texto que llega", async () => {
    await mountChat();
    const hold = deferred();
    server.reply({ kind: "ok", chunks: ["Qué bonito. ", "¿Qué sentiste?"], hold });
    await type("Me gustó el final");
    await tap(button("Enviar"));
    await settle();
    // Primer fragmento recibido: el indicador ya no esta y el texto va apareciendo.
    expect(root().querySelector('[data-testid="typing"]')).toBeNull();
    expect(root().querySelector('[data-testid="streaming-bubble"]')?.textContent).toBe("Qué bonito. ");
    expect(bubbles()).toContain("Me gustó el final");
    hold.resolve();
    await settle();
    expect(root().querySelector('[data-testid="streaming-bubble"]')).toBeNull();
    expect(bubbles().at(-1)).toBe("Qué bonito. ¿Qué sentiste?");
    expect(root().querySelector('[data-testid="zen-cycle"]')?.textContent).toBe("Ciclo Zen: Turno 2 de 5");
    expect(field().value).toBe("");
  });

  it("'Komi está escribiendo' aparece desde el envio y dura hasta el primer fragmento", async () => {
    await mountChat();
    server.reply({ kind: "hang" });
    await type("Hola");
    await tap(button("Enviar"));
    await settle();
    const typing = root().querySelector('[data-testid="typing"]');
    expect(typing?.textContent).toContain("Komi está escribiendo");
    expect(typing?.getAttribute("role")).toBe("status");
    expect(typing?.querySelector("[aria-hidden='true']")).not.toBeNull();
  });

  it("bloquea el doble envio: dos toques seguidos hacen una sola peticion", async () => {
    await mountChat();
    server.reply({ kind: "ok", chunks: ["Ok"] }, { kind: "ok", chunks: ["No debería pedirse"] });
    await type("Hola");
    const send = button("Enviar") as HTMLButtonElement;
    await act(async () => {
      send.click();
      send.click();
      send.click();
    });
    await drain();
    expect(server.messageCalls()).toHaveLength(1);
    expect(server.pendingReplies()).toBe(1);
  });

  it("durante el envio el campo y el boton quedan bloqueados", async () => {
    await mountChat();
    server.reply({ kind: "hang" });
    await type("Hola");
    await tap(button("Enviar"));
    await settle();
    expect(field().disabled).toBe(true);
    expect(button("Enviar")?.disabled).toBe(true);
  });

  it("reloadGate se bloquea SOLO mientras hay streaming", async () => {
    await mountChat();
    expect(gate.isBlocked()).toBe(false);
    const hold = deferred();
    server.reply({ kind: "ok", chunks: ["a", "b"], hold });
    await type("Hola");
    await tap(button("Enviar"));
    await settle();
    expect(gate.isBlocked()).toBe(true);
    hold.resolve();
    await settle();
    expect(gate.isBlocked()).toBe(false);
  });

  it("si una recarga se pidio durante el streaming, se hace al terminar", async () => {
    await mountChat();
    const hold = deferred();
    server.reply({ kind: "ok", chunks: ["a", "b"], hold });
    await type("Hola");
    await tap(button("Enviar"));
    await settle();
    gate.request();
    expect(reload).not.toHaveBeenCalled();
    hold.resolve();
    await settle();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("tras un error el gate tambien se suelta", async () => {
    await mountChat();
    await say("Hola", { kind: "sse_error", code: "unavailable" });
    expect(gate.isBlocked()).toBe(false);
  });

  it("charla completa: 4 envios, contador de 1 a 5, semilla y boton de cierre", async () => {
    await mountChat();
    for (let i = 1; i <= 3; i += 1) {
      await say(`mensaje ${i}`, { kind: "ok", chunks: [`Respuesta ${i}`] });
      expect(root().querySelector('[data-testid="zen-cycle"]')?.textContent).toBe(`Ciclo Zen: Turno ${i + 1} de 5`);
    }
    await say("mensaje 4", { kind: "ok", chunks: ["Cierre de Komi"], seed: "Leer es sembrar." });
    expect(root().querySelector('[data-testid="zen-cycle"]')?.textContent).toBe("Ciclo Zen: Turno 5 de 5");
    expect(field()).toBeNull();
    expect(root().querySelector('[data-testid="seed"]')?.textContent).toContain("Leer es sembrar.");
    expect(bubbles()).toHaveLength(9);
    const row = await db.reflections.toCollection().first();
    expect(row).toMatchObject({ turn_count: 5, is_closed: true, key_takeaway: "Leer es sembrar.", book_id: BOOK.id });
    await tap(button("Guardar reflexión y volver al jardín"));
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it("charla cerrada sin semilla: mensaje de cierre y el mismo boton", async () => {
    await mountChat();
    for (let i = 1; i <= 4; i += 1) await say(`m${i}`, { kind: "ok", chunks: ["Ok"] });
    expect(root().querySelector('[data-testid="seed"]')?.textContent).toContain("Tu charla con Komi terminó");
    expect(button("Guardar reflexión y volver al jardín")).toBeDefined();
  });

  it("retomar una charla ya cerrada la muestra cerrada con su semilla", async () => {
    await mountChat();
    for (let i = 1; i <= 4; i += 1) {
      await say(`m${i}`, { kind: "ok", chunks: ["Ok"], seed: "Una semilla." });
    }
    mounted?.unmount();
    await mountChat();
    expect(root().querySelector('[data-testid="zen-cycle"]')?.textContent).toBe("Ciclo Zen: Turno 5 de 5");
    expect(root().querySelector('[data-testid="seed"]')?.textContent).toContain("Una semilla.");
    expect(field()).toBeNull();
  });
});

describe("errores del envio", () => {
  it("el error descarta el texto parcial, conserva el mensaje y permite reenviar el mismo turno", async () => {
    await mountChat();
    await say("Mi respuesta", { kind: "sse_error", code: "unavailable", before: ["Texto parcial de Komi"] });
    expect(text()).not.toContain("Texto parcial de Komi");
    expect(root().querySelector('[data-testid="streaming-bubble"]')).toBeNull();
    expect(bubbles()).toHaveLength(1);
    expect(field().value).toBe("Mi respuesta");
    expect(text()).toContain("Komi no pudo responder ahora mismo");
    expect(root().querySelector('[data-testid="zen-cycle"]')?.textContent).toBe("Ciclo Zen: Turno 1 de 5");
    expect(button("Reintentar")?.disabled).toBe(false);
    server.reply({ kind: "ok", chunks: ["Ahora sí"] });
    await tap(button("Reintentar"));
    await settle();
    expect(bubbles().at(-1)).toBe("Ahora sí");
    expect(server.messageCalls().map((c) => c.body)).toEqual([
      { content: "Mi respuesta", turn: 1 },
      { content: "Mi respuesta", turn: 1 },
    ]);
    expect(text()).not.toContain("Komi no pudo responder");
  });

  it("sin red al enviar: aviso gentil, mensaje conservado y reintento inmediato", async () => {
    await mountChat();
    await say("Hola", { kind: "network" });
    expect(text()).toContain("No hay conexión en este momento");
    expect(field().value).toBe("Hola");
    expect(button("Reintentar")?.disabled).toBe(false);
  });

  it("a los 60 s sin respuesta: aviso de tiempo agotado y se descarta lo parcial", async () => {
    await mountChat();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    server.reply({ kind: "hang", before: ["parcial"] });
    await type("Hola");
    await act(async () => {
      button("Enviar")?.click();
    });
    // El temporizador de 60 s se arma al salir la peticion: se espera a eso antes de mover el reloj.
    await until(() => server.messageCalls().length === 1);
    await drain();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_001);
    });
    await drain();
    expect(text()).toContain("Komi tardó demasiado en responder");
    expect(text()).not.toContain("parcial");
    expect(field().value).toBe("Hola");
    expect(gate.isBlocked()).toBe(false);
  });

  it("respuesta truncada: aviso propio y reintento", async () => {
    await mountChat();
    await say("Hola", { kind: "sse_error", code: "truncated" });
    expect(text()).toContain("La respuesta de Komi se cortó");
    expect(button("Reintentar")?.disabled).toBe(false);
  });

  it("cuota agotada con retry_after: Reintentar deshabilitado con cuenta atras visible", async () => {
    await mountChat();
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    await say("Hola", { kind: "sse_error", code: "quota_exceeded", retry_after: 12 });
    expect(text()).toContain("Komi necesita descansar un momento");
    expect(text()).toContain("Podrás reintentar en 12 s");
    expect(button("Reintentar")?.disabled).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(text()).toContain("Podrás reintentar en 7 s");
    expect(button("Reintentar")?.disabled).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(7_000);
    });
    expect(text()).not.toContain("Podrás reintentar");
    expect(button("Reintentar")?.disabled).toBe(false);
    server.reply({ kind: "ok", chunks: ["Gracias por esperar"] });
    vi.useRealTimers();
    await tap(button("Reintentar"));
    await settle();
    expect(bubbles().at(-1)).toBe("Gracias por esperar");
  });

  it("cuota agotada sin retry_after: el reintento queda disponible", async () => {
    await mountChat();
    await say("Hola", { kind: "sse_error", code: "quota_exceeded" });
    expect(text()).not.toContain("Podrás reintentar en");
    expect(button("Reintentar")?.disabled).toBe(false);
  });

  it("la cuenta atras de mas de 99 s se muestra en minutos", async () => {
    await mountChat();
    await say("Hola", { kind: "sse_error", code: "quota_exceeded", retry_after: 300 });
    expect(text()).toContain("Podrás reintentar en 5 min");
  });

  it("HTTP 429 con Retry-After tambien arma la cuenta atras", async () => {
    await mountChat();
    await say("Hola", { kind: "http", status: 429, headers: { "Retry-After": "20" } });
    expect(text()).toContain("Podrás reintentar en 20 s");
  });

  it("HTTP 503 del servidor: aviso generico y reintento inmediato", async () => {
    await mountChat();
    await say("Hola", { kind: "http", status: 503 });
    expect(text()).toContain("Komi no pudo responder ahora mismo");
    expect(button("Reintentar")?.disabled).toBe(false);
  });

  it("reply_in_progress: un reintento automatico y despues un aviso gentil", async () => {
    await mountChat();
    server.lock(SESSION);
    await say("Hola");
    expect(text()).toContain("Komi sigue respondiendo a tu mensaje anterior");
    expect(server.messageCalls()).toHaveLength(2);
    expect(field().value).toBe("Hola");
  });

  it("respuesta perdida: al reenviar se resincroniza y la charla avanza sin duplicar el mensaje", async () => {
    await mountChat();
    await say("Hola", { kind: "saved_but_lost", chunks: ["Respuesta guardada"] });
    expect(text()).toContain("Komi no pudo responder ahora mismo");
    await tap(button("Reintentar"));
    await settle();
    expect(bubbles().filter((b) => b === "Hola")).toHaveLength(1);
    expect(bubbles().at(-1)).toBe("Respuesta guardada");
    expect(root().querySelector('[data-testid="zen-cycle"]')?.textContent).toBe("Ciclo Zen: Turno 2 de 5");
    expect(field().value).toBe("");
  });

  it("turn_mismatch por otro dispositivo: se actualiza la charla y se conserva el texto", async () => {
    await mountChat();
    const serverChat = server.chatOf(SESSION);
    if (serverChat) {
      serverChat.turn_count = 2;
      serverChat.messages.push(
        { id: 90, sender: "USER", content: "Desde el otro", turn_number: 1, created_at: "x" },
        { id: 91, sender: "KOMI_AI", content: "Respuesta del otro", turn_number: 2, created_at: "x" },
      );
    }
    await say("Mi mensaje");
    expect(text()).toContain("Actualizamos la charla");
    expect(bubbles()).toContain("Respuesta del otro");
    expect(field().value).toBe("Mi mensaje");
    expect(root().querySelector('[data-testid="zen-cycle"]')?.textContent).toBe("Ciclo Zen: Turno 2 de 5");
  });
});

describe("limite de 2000 caracteres", () => {
  it("2000 caracteres se pueden enviar; el contador aparece cerca del tope", async () => {
    await mountChat();
    await type("a".repeat(1900));
    expect(text()).toContain("1900 de 2000 caracteres");
    await type("a".repeat(2000));
    expect(text()).toContain("2000 de 2000 caracteres");
    expect(button("Enviar")?.disabled).toBe(false);
  });

  it("con 2001 caracteres el envio se bloquea y se explica", async () => {
    await mountChat();
    await type("a".repeat(2001));
    expect(button("Enviar")?.disabled).toBe(true);
    expect(text()).toContain("2001 de 2000 caracteres");
    expect(text()).toContain("Acorta tu mensaje");
    await tap(button("Enviar"));
    expect(server.messageCalls()).toHaveLength(0);
  });

  it("no cuenta los espacios de los extremos", async () => {
    await mountChat();
    await type(`  ${"a".repeat(2000)}  `);
    expect(button("Enviar")?.disabled).toBe(false);
  });

  it("un mensaje solo de espacios no se envia", async () => {
    await mountChat();
    await type("     ");
    expect(button("Enviar")?.disabled).toBe(true);
  });
});

describe("salir", () => {
  it("antes del turno 5 pide confirmacion amable y 'Seguir charlando' vuelve a la charla", async () => {
    await mountChat();
    await tap(button("Volver al jardín"));
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("Si sales ahora, no podrás retomar esta charla.");
    expect(onLeave).not.toHaveBeenCalled();
    await tap(button("Seguir charlando"));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(onLeave).not.toHaveBeenCalled();
    expect(field()).not.toBeNull();
  });

  it("'Salir de todos modos' abandona la charla", async () => {
    await mountChat();
    await tap(button("Volver al jardín"));
    await tap(button("Salir de todos modos"));
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it("con la charla cerrada no se pide confirmacion", async () => {
    await mountChat();
    for (let i = 1; i <= 4; i += 1) await say(`m${i}`, { kind: "ok", chunks: ["Ok"], seed: "Semilla" });
    await tap(button("Guardar reflexión y volver al jardín"));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it("al desmontar durante el streaming se cancela el stream y se suelta la recarga", async () => {
    await mountChat();
    server.reply({ kind: "hang", before: ["Empiezo a responder"] });
    await type("Hola");
    await tap(button("Enviar"));
    await settle();
    expect(gate.isBlocked()).toBe(true);
    const signal = server.messageCalls()[0]?.signal;
    expect(signal?.aborted).toBe(false);
    mounted?.unmount();
    mounted = null;
    await settle();
    expect(signal?.aborted).toBe(true);
    expect(server.state.cancelled).toBeGreaterThan(0);
    expect(gate.isBlocked()).toBe(false);
    expect(await db.reflections.toCollection().first()).toMatchObject({ turn_count: 1 });
  });
});

describe("accesibilidad y estilo", () => {
  it("los textos usan tildes y no hay emojis en la pantalla", async () => {
    await mountChat();
    await type("a".repeat(1900));
    expect(text()).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(text()).toContain("Volver al jardín");
    expect(text()).toContain("Tu respuesta");
  });

  it("el mensaje del lector no se escribe en la consola", async () => {
    const spies = [vi.spyOn(console, "log"), vi.spyOn(console, "error"), vi.spyOn(console, "warn")];
    await mountChat();
    await say("Texto privado del lector", { kind: "sse_error", code: "internal" });
    for (const spy of spies) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain("Texto privado");
      spy.mockRestore();
    }
  });
});
