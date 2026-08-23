import { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?:
    | "gold"
    | "available"
    | "pending"
    | "sold"
    | "neutral"
    | "condition-nm"
    | "condition-yellow"
    | "condition-hp"
    | "condition-dmg"
    | "rarity-standard"
    | "rarity-chase";
}

const toneClasses: Record<NonNullable<BadgeProps["tone"]>, string> = {
  gold: "bg-navy-950 text-gold border border-gold",
  available: "bg-available-bg text-available border border-available/30",
  pending: "bg-pending-bg text-pending border border-pending/30",
  sold: "bg-sold-bg text-sold border border-sold/30",
  neutral: "bg-foreground/5 text-foreground-muted border border-card-border",
  "condition-nm": "bg-navy-950 text-emerald-400 border border-emerald-400",
  "condition-yellow": "bg-navy-950 text-yellow-400 border border-yellow-400",
  "condition-hp": "bg-navy-950 text-orange-400 border border-orange-400",
  "condition-dmg": "bg-navy-950 text-red-400 border border-red-400",
  "rarity-standard": "bg-foreground/5 text-foreground-muted border border-card-border",
  "rarity-chase": "bg-navy-950 text-gold border border-gold",
};

export function Badge({ tone = "neutral", className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold tracking-wide",
        toneClasses[tone],
        className,
      )}
      {...props}
    />
  );
}
