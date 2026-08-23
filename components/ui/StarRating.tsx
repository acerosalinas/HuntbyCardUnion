"use client";

import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

interface StarRatingProps {
  value: number;
  onChange?: (value: number) => void;
  readOnly?: boolean;
  size?: number;
}

/** 1-5 star picker. Interactive by default; pass readOnly to render a plain display (e.g. an average rating). */
export function StarRating({ value, onChange, readOnly = false, size = 20 }: StarRatingProps) {
  return (
    <div className="flex items-center gap-0.5" role={readOnly ? undefined : "radiogroup"} aria-label="Rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={readOnly}
          onClick={() => onChange?.(n)}
          aria-label={`${n} star${n === 1 ? "" : "s"}`}
          className={cn("transition-colors", readOnly ? "cursor-default" : "cursor-pointer hover:text-gold")}
        >
          <Star
            size={size}
            className={n <= Math.round(value) ? "fill-gold text-gold" : "fill-transparent text-card-border"}
          />
        </button>
      ))}
    </div>
  );
}
