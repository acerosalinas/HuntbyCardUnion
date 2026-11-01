"use client";

import { PointerEvent } from "react";
import Link from "next/link";
import { Store } from "lucide-react";
import { SellerProfile } from "@/types/marketplace";

export function SellerSpotlightCard({ profile, cardCount }: { profile: SellerProfile; cardCount: number }) {
  // Feeds the cursor position to the CSS spotlight (.spotlight-card in globals.css).
  // Written straight to the element's style - no state, so moving the mouse never re-renders.
  const trackPointer = (e: PointerEvent<HTMLAnchorElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty("--mx", `${e.clientX - rect.left}px`);
    e.currentTarget.style.setProperty("--my", `${e.clientY - rect.top}px`);
  };

  return (
    <Link
      href={`/sellers/${profile.handle}`}
      onPointerMove={trackPointer}
      // 2-up on mobile (half the row width, minus half the gap so two cards
      // plus the gap between them exactly fill it), fixed width from sm: up.
      className="spotlight-card group flex w-[calc(50%-0.5rem)] flex-col items-center rounded-2xl border border-card-border bg-card p-4 text-center outline-none focus-visible:border-gold sm:w-56 sm:p-5"
    >
      <div className="mb-3 flex h-16 w-16 items-center justify-center overflow-hidden rounded-full border-2 border-gold bg-navy-950 text-gold transition-transform duration-500 ease-out motion-safe:group-hover:scale-105">
        {profile.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- arbitrary seller-supplied image URL
          <img src={profile.avatarUrl} alt={profile.displayName} loading="lazy" decoding="async" className="h-full w-full object-cover" />
        ) : (
          <Store size={24} />
        )}
      </div>
      <p className="font-display text-sm font-semibold text-foreground">{profile.displayName}</p>
      <p className="text-xs text-foreground-muted">
        {cardCount} listing{cardCount === 1 ? "" : "s"}
      </p>
      {profile.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap justify-center gap-1">
          {profile.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-navy-950 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gold"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </Link>
  );
}
