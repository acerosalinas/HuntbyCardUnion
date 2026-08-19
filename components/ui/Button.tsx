import { ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "gold" | "outline" | "ghost" | "danger" | "disabled";

const variantClasses: Record<Variant, string> = {
  primary:
    "bg-available text-white hover:brightness-110 shadow-sm shadow-available/30",
  gold: "bg-gold text-navy-950 hover:brightness-105 shadow-sm shadow-gold/30 font-semibold",
  outline:
    "border border-card-border bg-transparent text-foreground hover:bg-foreground/5",
  ghost: "bg-transparent text-foreground hover:bg-foreground/5",
  danger: "bg-sold text-white hover:brightness-110",
  disabled: "bg-foreground/10 text-foreground-muted cursor-not-allowed",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled}
        className={cn(
          "inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium tracking-wide transition-all duration-150 disabled:opacity-60 disabled:cursor-not-allowed",
          variantClasses[disabled ? "disabled" : variant],
          className,
        )}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";
