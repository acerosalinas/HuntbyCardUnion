import { InputHTMLAttributes, TextareaHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "w-full rounded-lg border border-card-border bg-background-elevated px-3 py-2 text-sm text-foreground placeholder:text-foreground-muted outline-none transition-colors focus:border-gold focus:ring-2 focus:ring-gold/20",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "w-full rounded-lg border border-card-border bg-background-elevated px-3 py-2 text-sm text-foreground placeholder:text-foreground-muted outline-none transition-colors focus:border-gold focus:ring-2 focus:ring-gold/20",
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";
