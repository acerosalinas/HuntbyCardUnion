"use client";

import { useMemo } from "react";
import Link from "next/link";
import { CardTile } from "@/components/CardTile";
import { useRealtimeCards } from "@/hooks/useRealtimeCards";
import { CardItem } from "@/types/marketplace";

/** The most cards the row carries. Beyond this the page would get heavy on phones; "See all" opens the full marketplace. */
const MAX_CARDS = 48;

/**
 * Takes one card from each seller in turn (newest first within a seller), so no single seller can fill the row by
 * listing a lot at once. Sellers are ordered by their newest listing; a seller with fewer cards simply drops out
 * of later rounds.
 */
function mixSellers(cards: CardItem[]): CardItem[] {
  const bySeller = new Map<string, CardItem[]>();
  for (const card of [...cards].sort((a, b) => b.createdAt - a.createdAt)) {
    const key = card.adminId ?? card.sellerHandle;
    bySeller.set(key, [...(bySeller.get(key) ?? []), card]);
  }
  const queues = [...bySeller.values()];
  const mixed: CardItem[] = [];
  for (let round = 0; mixed.length < cards.length; round++) {
    for (const queue of queues) if (round < queue.length) mixed.push(queue[round]);
  }
  return mixed;
}

/**
 * Cards for sale from every seller, drifting sideways like a shop window. It follows the `cards` table live
 * (useRealtimeCards): a new listing joins the showcase, a sold-out or removed one leaves it, with no reload.
 * Reuses the vouch wall's marquee styles (globals.css): the track holds two identical copies and slides exactly
 * half its width, so the loop never jumps. It pauses on hover or focus; with reduced motion it becomes a plain
 * scrollable strip and the second copy is hidden.
 */
export function CardShowcase({ initialCards }: { initialCards: CardItem[] }) {
  const live = useRealtimeCards(initialCards);
  const forSale = useMemo(() => live.filter((c) => c.status === "AVAILABLE" || c.status === "PENDING"), [live]);
  const cards = useMemo(() => mixSellers(forSale).slice(0, MAX_CARDS), [forSale]);

  if (cards.length === 0) return null;

  // A steady pace whatever the count: about 5 seconds per card, so a long list never speeds up.
  const duration = Math.max(40, cards.length * 5);

  return (
    <section aria-labelledby="shelf-heading" className="mb-12 w-full">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 id="shelf-heading" className="font-display text-xl font-medium text-foreground sm:text-2xl">
          On the shelf
        </h2>
        <Link href="/marketplace" className="text-sm font-medium text-gold-ink underline-offset-4 hover:underline">
          See all {forSale.length}
        </Link>
      </div>
      <div className="vouch-marquee -mx-4 w-[calc(100%+2rem)] sm:mx-0 sm:w-full" role="region" aria-label="All cards for sale">
      <div className="vouch-track" data-reverse="" style={{ ["--vouch-duration" as string]: `${duration}s` }}>
        {[0, 1].map((copy) => (
          <div
            key={copy}
            className="flex shrink-0 gap-3 pr-3 sm:gap-4 sm:pr-4"
            {...(copy === 1 ? { "aria-hidden": true, inert: true, "data-dup": "" } : {})}
          >
            {cards.map((card) => (
              <div key={card.id} className="w-40 shrink-0 sm:w-52">
                <CardTile card={card} />
              </div>
            ))}
          </div>
        ))}
      </div>
      </div>
    </section>
  );
}
