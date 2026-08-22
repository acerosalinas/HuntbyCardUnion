"use client";

import { useEffect, useRef, useState } from "react";
import { ImageOff, Pause, Play, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ConditionBadges } from "@/components/ConditionBadges";
import { cn, formatCurrency } from "@/lib/utils";
import { CardItem } from "@/types/marketplace";

const TOSS_DURATION_MS = 500;
const STACK_DEPTH = 3;
const DEFAULT_INTERVAL_SECONDS = 4;

/**
 * Auto-advancing "stack & toss" showcase for a seller's live-selling stream -
 * purely a visual aid the seller controls (speed via their profile's setting,
 * play/pause here), not something viewers interact with. Every
 * `intervalSeconds`, the top card animates off and the next one in `cards`
 * becomes active, looping indefinitely for as long as the seller leaves it
 * playing - there is no built-in stop condition, only the pause button below.
 */
export function LiveModeStack({ cards, intervalSeconds }: { cards: CardItem[]; intervalSeconds: number }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [tossing, setTossing] = useState(false);
  const [playing, setPlaying] = useState(true);
  const reducedMotionRef = useRef(false);

  // Defends against intervalSeconds arriving as undefined/NaN (e.g. a
  // profile read before supabase/migration_live_mode.sql has actually run
  // against the database, where the column doesn't exist yet despite the
  // TypeScript type claiming it's always a number) - Math.max(1, NaN) is
  // NaN, and setInterval(fn, NaN) fires almost continuously instead of
  // pacing normally, which looks exactly like a broken, glitchy loop.
  const effectiveIntervalSeconds =
    Number.isFinite(intervalSeconds) && intervalSeconds > 0 ? intervalSeconds : DEFAULT_INTERVAL_SECONDS;

  useEffect(() => {
    reducedMotionRef.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  useEffect(() => {
    if (activeIndex >= cards.length) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clamping the active index after the underlying card list shrinks
      setActiveIndex(0);
    }
  }, [cards.length, activeIndex]);

  useEffect(() => {
    if (cards.length <= 1 || !playing) return;

    const advance = () => {
      if (reducedMotionRef.current) {
        setActiveIndex((i) => (i + 1) % cards.length);
        return;
      }
      setTossing(true);
      setTimeout(() => {
        setActiveIndex((i) => (i + 1) % cards.length);
        setTossing(false);
      }, TOSS_DURATION_MS);
    };

    const interval = setInterval(advance, effectiveIntervalSeconds * 1000);
    return () => clearInterval(interval);
  }, [cards.length, effectiveIntervalSeconds, playing]);

  if (cards.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-card-border py-24 text-center">
        <Sparkles size={28} className="mb-3 text-foreground-muted" />
        <p className="text-sm text-foreground-muted">No cards live right now.</p>
      </div>
    );
  }

  const depth = Math.min(STACK_DEPTH, cards.length);
  const visible = Array.from({ length: depth }, (_, i) => cards[(activeIndex + i) % cards.length]);

  return (
    <div className="mx-auto w-full max-w-sm">
      <div className="relative aspect-[3/4] w-full">
        {visible.map((card, stackPos) => {
          const isActive = stackPos === 0;
          return (
            <div
              key={card.id}
              className={cn(
                "absolute inset-0 overflow-hidden rounded-2xl border border-card-border bg-card shadow-lg transition-all duration-500 ease-in",
                isActive && tossing && "translate-x-[140%] -translate-y-[8%] rotate-[18deg] opacity-0",
              )}
              style={
                isActive
                  ? { zIndex: depth }
                  : {
                      transform: `scale(${1 - stackPos * 0.05}) translateY(${stackPos * 10}px)`,
                      opacity: 1 - stackPos * 0.25,
                      zIndex: depth - stackPos,
                    }
              }
            >
              <div className="relative h-full w-full bg-navy-950/5">
                {card.images[0] ? (
                  // eslint-disable-next-line @next/next/no-img-element -- arbitrary seller-supplied image URLs
                  <img src={card.images[0]} alt={card.title} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-foreground-muted">
                    <ImageOff size={32} />
                  </div>
                )}
                <div className="absolute left-2 top-2 flex flex-wrap gap-1.5">
                  <ConditionBadges conditionGrade={card.conditionGrade} />
                </div>
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-navy-950/90 to-transparent p-4 pt-10">
                  <p className="line-clamp-1 font-semibold text-ivory">{card.title}</p>
                  <div className="flex items-center justify-between gap-2">
                    <p className="line-clamp-1 text-sm text-ivory/70">{card.setName}</p>
                    <p className="shrink-0 text-lg font-bold text-gold">{formatCurrency(card.price)}</p>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex items-center justify-center gap-3">
        <Button variant="outline" onClick={() => setPlaying((p) => !p)} disabled={cards.length <= 1}>
          {playing ? <Pause size={14} /> : <Play size={14} />}
          {playing ? "Pause" : "Resume"}
        </Button>
        <p className="text-xs text-foreground-muted">
          {activeIndex + 1} / {cards.length}
        </p>
      </div>
    </div>
  );
}
