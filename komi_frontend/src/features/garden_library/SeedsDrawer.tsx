import { ZenSheet } from "../../core/components/ZenSheet";
import type { LocalBook } from "../../data/local_db/types";
import { seedCountLabel, type Seed } from "../../services/seedService";
import "./SeedsDrawer.css";

export interface SeedsDrawerProps {
  book: LocalBook;
  seeds: readonly Seed[];
  onClose: () => void;
}

/** Cajon de "Semillas del Dia" de un libro (SRS 10.3): la frase de cada charla y su fecha. */
export function SeedsDrawer({ book, seeds, onClose }: SeedsDrawerProps) {
  return (
    <ZenSheet title="Semillas del Día" onClose={onClose}>
      <div className="seeds">
        <p className="seeds__book">
          {book.title}
          {seeds.length > 0 && <span className="seeds__count tabular"> · {seedCountLabel(seeds.length)}</span>}
        </p>
        {seeds.length === 0 ? (
          <p className="seeds__empty">
            Aún no hay semillas en este libro. Al terminar una charla con Komi, su frase del día se guarda aquí.
          </p>
        ) : (
          <ul className="seeds__list">
            {seeds.map((seed) => (
              <li key={seed.chatId} className="seeds__item">
                <p className="seeds__text">{seed.text}</p>
                <p className="seeds__date">{seed.dateLabel}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </ZenSheet>
  );
}
