import { InputHTMLAttributes, TextareaHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        // text-base (16px) below the sm breakpoint, not text-sm (14px) - iOS
        // Safari auto-zooms the page on focus for any input under 16px,
        // which is the "zooms in and the screen moves sideways" behavior.
        // Reverts to the original compact text-sm from sm: up, where that
        // zoom never triggers regardless of font size.
        "w-full rounded-lg border border-card-border bg-background-elevated px-3 py-2 text-base sm:text-sm text-foreground placeholder:text-foreground-muted outline-none transition-colors focus:border-gold focus:ring-2 focus:ring-gold/20 disabled:cursor-not-allowed disabled:opacity-60",
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
        // See the comment on Input above - same iOS auto-zoom fix.
        "w-full rounded-lg border border-card-border bg-background-elevated px-3 py-2 text-base sm:text-sm text-foreground placeholder:text-foreground-muted outline-none transition-colors focus:border-gold focus:ring-2 focus:ring-gold/20",
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";
