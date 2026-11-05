import { Check } from "lucide-react";
import { ICON_STROKE_WIDTH } from "../../core/theme/geometryTokens";
import "./QuizOptionCard.css";

interface QuizOptionCardProps {
  /** Nombre del grupo de radios (uno por pregunta). */
  name: string;
  value: string;
  label: string;
  selected: boolean;
  onSelect: (value: string) => void;
}

const CHECK_SIZE = 14;

/**
 * Tarjeta de opcion (SRS 10.4): ancho completo, minimo 60 px, radio 12 px; seleccionada con borde
 * de 2 px en Verde Salvia. Es un radio nativo: el teclado y el lector de pantalla funcionan sin
 * codigo extra (flechas para moverse, Espacio para elegir).
 */
export function QuizOptionCard({ name, value, label, selected, onSelect }: QuizOptionCardProps) {
  return (
    <label className="quiz-option" data-selected={selected ? "true" : "false"}>
      <input
        className="quiz-option__input"
        type="radio"
        name={name}
        value={value}
        checked={selected}
        onChange={() => onSelect(value)}
      />
      <span className="quiz-option__label">{label}</span>
      <span className="quiz-option__mark" aria-hidden="true">
        {selected && <Check size={CHECK_SIZE} strokeWidth={ICON_STROKE_WIDTH} />}
      </span>
    </label>
  );
}
