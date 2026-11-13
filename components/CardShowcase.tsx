"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CardTile } from "@/components/CardTile";
import { QuickLook } from "@/components/QuickLook";
import { useHomeCards } from "@/components/HomeCardsProvider";
import { buildChips } from "@/lib/homeFilters";
import { cn } from "@/lib/utils";
import { CardItem } from "@/types/marketplace";

/** The most cards the row carries. Beyond this the page would get heavy on phones; "See all" opens the full marketplace. */
const MAX_CARDS = 48;

/**
 * Folds separate listings of the same card (same seller, title, set and condition) into one tile, so a repeat
 * listing does not show twice in a row. The tile keeps the cheapest listing and counts the units of all of them.
 */
function foldDuplicates(cards: CardItem[]): CardItem[] {
  const folded = new Map<string, CardItem>();
  for (const card of cards) {
    const key = [card.adminId ?? card.sellerHandle, card.title, card.setName, card.conditionGrade, card.productType]
      .map((part) => String(part).trim().toLowerCase())
      .join("|");
    const seen = folded.get(key);
    if (!seen) {
      folded.set(key, card);
      continue;
    }
    const cheaper = card.price < seen.price ? card : seen;
    folded.set(key, {
      ...cheaper,
      quantity: seen.quantity + card.quantity,
      quantityAvailable: seen.quantityAvailable + card.quantityAvailable,
      createdAt: Math.max(seen.createdAt, card.createdAt),
    });
  }
  return [...folded.values()];
}

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
 * half its width, so the loop never jumps. The second copy is aria-hidden and skipped by Tab but stays clickable - about half
 * the time it is the one on screen, so it must never be inert. It pauses on hover or focus; with reduced motion it becomes a plain
 * scrollable strip and the second copy is hidden.
 */
export function CardShowcase() {
  const live = useHomeCards();
  const forSale = useMemo(() => live.filter((c) => c.status === "AVAILABLE" || c.status === "PENDING"), [live]);
  // Quick filters above the shelf (a game, a price, graded, sealed...) reshape what drifts past, in place.
  const chips = useMemo(() => buildChips(forSale), [forSale]);
  const [chipId, setChipId] = useState("all");
  const activeChip = chips.find((c) => c.id === chipId) ?? chips[0];
  const shown = useMemo(() => (activeChip ? forSale.filter(activeChip.test) : forSale), [forSale, activeChip]);
  const cards = useMemo(() => mixSellers(foldDuplicates(shown)).slice(0, MAX_CARDS), [shown]);
  const [lookCard, setLookCard] = useState<CardItem | null>(null);

  if (forSale.length === 0) return null;

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
      {chips.length > 2 && (
        <div className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0" role="group" aria-label="Filter the shelf">
          {chips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              aria-pressed={chip.id === activeChip?.id}
              onClick={() => setChipId(chip.id)}
              className={cn(
                "shrink-0 whitespace-nowrap rounded-full border px-3.5 py-2 text-xs font-medium tracking-wide transition-colors",
                chip.id === activeChip?.id ? "border-gold bg-gold text-navy-950" : "border-card-border text-foreground-muted hover:border-gold/50 hover:text-foreground",
              )}
            >
              {chip.label} <span className="opacity-70">{chip.count}</span>
            </button>
          ))}
        </div>
      )}
      <div className="vouch-marquee -mx-4 w-[calc(100%+2rem)] sm:mx-0 sm:w-full" role="region" aria-label="All cards for sale">
      <div className="vouch-track" data-reverse="" style={{ ["--vouch-duration" as string]: `${duration}s` }}>
        {[0, 1].map((copy) => (
          <div
            key={copy}
            className="flex shrink-0 gap-3 pr-3 sm:gap-4 sm:pr-4"
            {...(copy === 1 ? { "aria-hidden": true, "data-dup": "" } : {})}
          >
            {cards.map((card) => (
              <div key={card.id} className="w-40 shrink-0 sm:w-52">
                <CardTile card={card} decorative={copy === 1} onQuickLook={setLookCard} />
              </div>
            ))}
          </div>
        ))}
      </div>
      </div>
      {lookCard && <QuickLook card={lookCard} onClose={() => setLookCard(null)} />}
    </section>
  );
}
