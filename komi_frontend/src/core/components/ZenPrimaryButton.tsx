import type { ButtonHTMLAttributes } from "react";
import "./ZenPrimaryButton.css";

export type ZenButtonVariant = "primary" | "secondary";

interface ZenPrimaryButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** `primary` = CTA en Amarillo Ocre (56 px). `secondary` = ghost con borde (48 px). SRS 10.1. */
  variant?: ZenButtonVariant;
}

export function ZenPrimaryButton({
  variant = "primary",
  type = "button",
  className,
  ...rest
}: ZenPrimaryButtonProps) {
  const classes = ["zen-btn", `zen-btn--${variant}`, className].filter(Boolean).join(" ");
  return <button type={type} className={classes} {...rest} />;
}
