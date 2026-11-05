import { Minus, Plus } from "lucide-react";
import type { ButtonHTMLAttributes } from "react";
import { ICON_STROKE_WIDTH } from "../theme/geometryTokens";
import "./TimerStepperButton.css";

export type StepperDirection = "decrement" | "increment";

interface TimerStepperButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-label"> {
  direction: StepperDirection;
  /** Obligatoria: el boton solo tiene un icono, el nombre accesible lo da esta etiqueta. */
  "aria-label": string;
}

const ICON_SIZE = 20;

/** Boton circular [-] / [+] del selector de tiempo (SRS 10.1, 44x44 px). */
export function TimerStepperButton({
  direction,
  type = "button",
  className,
  ...rest
}: TimerStepperButtonProps) {
  const Icon = direction === "increment" ? Plus : Minus;
  const classes = ["timer-stepper", className].filter(Boolean).join(" ");
  return (
    <button type={type} className={classes} {...rest}>
      <Icon size={ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" />
    </button>
  );
}
