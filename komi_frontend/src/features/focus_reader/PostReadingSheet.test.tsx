// "Hablar con Komi" (SRS 10.8): con `autoChat` la hoja guarda la lectura y abre la charla sola en cuanto
// el servidor acepta la sesion; si no la acepta, muestra el motivo de siempre. Servicio y puerta falsos.

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LocalBook, LocalSession } from "../../data/local_db/types";
import type { SessionGate } from "../../data/network/syncService";
import type { PostReadingService, SaveResult } from "../../services/postReadingService";
import { click, render } from "../../test/render";
import { PostReadingSheet } from "./PostReadingSheet";

let mounted: ReturnType<typeof render> | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
});

const BOOK = {
  id: "b",
  title: "Kokoro",
  author: "Natsume Soseki",
  format_type: "EPUB",
  sunflower_variant: "CLASSIC",
  status: "ACTIVE",
  total_pages: null,
  current_page: 0,
  progress_percentage: 40,
  last_epub_cfi: null,
  created_at: "2026-11-01T00:00:00.000Z",
  completed_at: null,
  updated_at: "2026-11-01T00:00:00.000Z",
  pending_sync: 0,
} as LocalBook;

const SESSION = { id: "s", book_id: "b", actual_duration_sec: 600 } as LocalSession;

const SAVED: Extract<SaveResult, { kind: "saved" }> = {
  kind: "saved",
  session: SESSION,
  book: BOOK,
  before: 12,
  solarBonus: false,
  bloomed: false,
  streak: 3,
  created: true,
};

function service(): PostReadingService {
  return {
    prepare: vi.fn(async () => ({
      kind: "ready" as const,
      record: {} as never,
      actualSec: 600,
      book: BOOK,
      progress: null,
      belowHalf: false,
    })),
    save: vi.fn(async () => SAVED),
  } as unknown as PostReadingService;
}

const settle = () => act(async () => new Promise((r) => setTimeout(r, 20)));
const text = () => document.querySelector('[role="dialog"]')?.textContent ?? "";
const button = (label: string) =>
  [...document.querySelectorAll("button")].find((b) => b.textContent?.trim().startsWith(label));

async function mount(over: {
  autoChat?: boolean;
  gate?: (sessionId: string) => Promise<SessionGate>;
  onChat?: () => void;
}) {
  const onChat = over.onChat ?? vi.fn();
  const checkChat = vi.fn(over.gate ?? (async () => ({ state: "ready" }) as SessionGate));
  mounted = render(
    <PostReadingSheet
      sessionId="s"
      actualSec={600}
      {...(over.autoChat === undefined ? {} : { autoChat: over.autoChat })}
      service={service()}
      onSaved={vi.fn()}
      onDiscard={vi.fn(async () => {})}
      onDone={vi.fn()}
      onChat={onChat}
      checkChat={checkChat}
    />,
  );
  await settle();
  await settle();
  return { onChat, checkChat };
}

describe("PostReadingSheet con Hablar con Komi (autoChat)", () => {
  it("con la sesion aceptada abre la charla sola, una sola vez, con la lectura guardada", async () => {
    const { onChat } = await mount({ autoChat: true });
    expect(onChat).toHaveBeenCalledTimes(1);
    expect(onChat).toHaveBeenCalledWith(SAVED);
    await settle();
    expect(onChat).toHaveBeenCalledTimes(1);
  });

  it("mientras el servidor responde no hace la pregunta de charlar: ya se pidio", async () => {
    let release: (gate: SessionGate) => void = () => {};
    const { onChat } = await mount({
      autoChat: true,
      gate: () => new Promise<SessionGate>((resolve) => (release = resolve)),
    });
    expect(text()).toContain("Lectura guardada");
    expect(text()).toContain("Sincronizando tu sesión");
    expect(text()).not.toContain("¿Quieres charlar");
    expect(onChat).not.toHaveBeenCalled();
    release({ state: "ready" });
    await settle();
    expect(onChat).toHaveBeenCalledTimes(1);
  });

  it("si el servidor no acepta la sesion no abre la charla y da el motivo de siempre", async () => {
    const { onChat } = await mount({ autoChat: true, gate: async () => ({ state: "rejected", code: "x" }) });
    expect(onChat).not.toHaveBeenCalled();
    expect(text()).toContain("El servidor no pudo validar esta sesión");
    expect(text()).not.toContain("x");
    expect(text()).toContain("¿Quieres charlar");
    expect((button("Sí, conversar con Komi") as HTMLButtonElement).disabled).toBe(true);
  });

  it("sin conexion da el motivo, deja Reintentar y al reintentar con exito abre la charla", async () => {
    const answers: SessionGate[] = [{ state: "offline" }, { state: "ready" }];
    const { onChat, checkChat } = await mount({ autoChat: true, gate: async () => answers.shift() ?? { state: "ready" } });
    expect(onChat).not.toHaveBeenCalled();
    expect(text()).toContain("No hay conexión con el servidor");
    click(button("Reintentar"));
    await settle();
    expect(checkChat).toHaveBeenCalledTimes(2);
    expect(onChat).toHaveBeenCalledTimes(1);
  });

  it("sin autoChat no abre nada: ofrece la pregunta y espera el toque", async () => {
    const { onChat } = await mount({ autoChat: false });
    expect(onChat).not.toHaveBeenCalled();
    expect(text()).toContain("¿Quieres charlar");
    expect((button("Sí, conversar con Komi") as HTMLButtonElement).disabled).toBe(false);
    click(button("Sí, conversar con Komi"));
    expect(onChat).toHaveBeenCalledTimes(1);
  });

  it("por defecto (sin la prop) se comporta como sin autoChat", async () => {
    const { onChat } = await mount({});
    expect(onChat).not.toHaveBeenCalled();
    expect(text()).toContain("¿Quieres charlar");
  });
});
