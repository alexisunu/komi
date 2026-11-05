import "./EmptyScreen.css";

interface EmptyScreenProps {
  title: string;
  message: string;
}

/** Pantalla vacia de v1.0 (bloque 7): un titulo y una frase. El contenido llega en la Fase 4. */
export function EmptyScreen({ title, message }: EmptyScreenProps) {
  return (
    <section className="empty-screen" data-block="empty">
      <h1 className="empty-screen__title">{title}</h1>
      <p className="empty-screen__message">{message}</p>
    </section>
  );
}
