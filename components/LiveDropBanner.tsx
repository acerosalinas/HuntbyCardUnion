"use client";

import { Sparkles } from "lucide-react";
import { useCountdown } from "@/hooks/useCountdown";
import { formatCountdown } from "@/lib/utils";

export function LiveDropBanner({ nextDropAt }: { nextDropAt: number | null }) {
  const remaining = useCountdown(nextDropAt);

  if (!nextDropAt || remaining <= 0) return null;

  return (
    <div className="relative mb-6 overflow-hidden rounded-2xl border border-gold/40 bg-navy-950 px-5 py-4 text-ivory glow-gold">
      <div className="relative flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkles size={18} className="text-gold" />
          <span className="font-semibold tracking-wide">Next Group Drop</span>
        </div>
        <span className="font-mono text-xl font-bold text-gold">{formatCountdown(remaining)}</span>
      </div>
    </div>
  );
}
