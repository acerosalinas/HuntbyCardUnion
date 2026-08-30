"use client";

import { ReactNode, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  className?: string;
}

/**
 * Slide-in-from-right panel, following the same hand-rolled conventions as
 * ui/Modal.tsx (controlled open/onClose, escape-key close, body-scroll-lock,
 * overlay-click-to-close) rather than a UI-kit dependency - this app has
 * none (no Radix/shadcn, confirmed via package.json), everything under
 * components/ui is plain Tailwind.
 *
 * Differs from Modal in two ways a slide panel needs and a centered dialog
 * doesn't: it stays mounted at all times and toggles visibility via a
 * transform/opacity transition (Modal just conditionally unmounts, which
 * would pop instead of slide), and it does basic focus management (moves
 * focus into the panel on open, restores it to whatever triggered the open
 * on close) - not a full Tab-trapping focus loop, which is a bigger,
 * separate fix already flagged for Modal.tsx and out of scope here.
 */
export function Drawer({ open, onClose, title, children, className }: DrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";

    previouslyFocused.current = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      previouslyFocused.current?.focus();
    };
  }, [open, onClose]);

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 bg-navy-950/60 backdrop-blur-sm transition-opacity duration-300 motion-reduce:transition-none",
        open ? "opacity-100" : "pointer-events-none opacity-0",
      )}
      onClick={onClose}
      aria-hidden={!open}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "glass fixed inset-y-0 right-0 flex h-full w-full max-w-xs flex-col border-l border-card-border shadow-2xl outline-none",
          "transition-transform duration-300 motion-reduce:transition-none",
          open ? "translate-x-0" : "translate-x-full",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}
