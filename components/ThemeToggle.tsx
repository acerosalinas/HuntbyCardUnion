"use client";

import { useEffect, useState } from "react";
import { useTheme } from "@/components/ThemeProvider";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration-safe mount flag so the icon only reflects the real theme after mount
    setMounted(true);
  }, []);

  const isDark = mounted && theme === "dark";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      aria-label="Toggle dark mode"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className={cn(
        "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border border-card-border bg-foreground/5 transition-colors sm:h-8 sm:w-14",
        isDark && "bg-navy-800 border-gold/40",
        className,
      )}
    >
      <span
        className={cn(
          "inline-flex h-5 w-5 translate-x-1 items-center justify-center rounded-full bg-background-elevated shadow transition-transform sm:h-6 sm:w-6",
          isDark && "translate-x-6 bg-gold text-navy-950 sm:translate-x-7",
        )}
      >
        {isDark ? <Moon size={12} /> : <Sun size={12} />}
      </span>
    </button>
  );
}
