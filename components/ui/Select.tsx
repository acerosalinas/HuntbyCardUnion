import { SelectHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        "w-full rounded-lg border border-card-border bg-background-elevated px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-gold focus:ring-2 focus:ring-gold/20",
        className,
      )}
      {...props}
    />
  ),
);
Select.displayName = "Select";
