"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Hourglass, ImageOff, PackageSearch } from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";
import { useBuyerIdentity } from "@/components/BuyerIdentityProvider";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { cn, formatCurrency } from "@/lib/utils";
import {
  CardItem,
  CardOffer,
  CardRow,
  OfferRow,
  cardFromRow,
  offerFromRow,
  QueueEntryRow,
  queueEntryFromRow,
} from "@/types/marketplace";

interface QueuedCardView {
  card: CardItem;
  position: number;
}

interface OfferedCardView {
  card: CardItem;
  offer: CardOffer;
}

const COUNTERED_PREFIX = "Countered by admin";

export function MyDibsContents() {
  const { buyer } = useBuyerIdentity();
  const [cards, setCards] = useState<CardItem[]>([]);
  const [queuedCards, setQueuedCards] = useState<QueuedCardView[]>([]);
  const [offeredCards, setOfferedCards] = useState<OfferedCardView[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!buyer || !isSupabaseConfigured()) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- toggling a loading flag before an async fetch
    setLoading(true);
    const supabase = createClient();

    Promise.all([
      supabase.from("cards").select("*").eq("claimant_id", buyer.id),
      supabase.from("dibs_queue").select("*").eq("buyer_id", buyer.id).eq("status", "WAITING"),
      supabase.from("offers").select("*").eq("buyer_id", buyer.id).order("created_at", { ascending: false }),
    ]).then(async ([claimedRes, myQueueRes, myOffersRes]) => {
      setCards(((claimedRes.data as CardRow[] | null) ?? []).map(cardFromRow));

      const myOfferRows = (myOffersRes.data as OfferRow[] | null) ?? [];
      if (myOfferRows.length > 0) {
        const offerCardIds = [...new Set(myOfferRows.map((r) => r.card_id))];
        const { data: offerCardsData } = await supabase.from("cards").select("*").in("id", offerCardIds);
        const offerCardsById = new Map(
          (((offerCardsData as CardRow[] | null) ?? []).map((r) => [r.id, cardFromRow(r)]) as [string, CardItem][]),
        );
        setOfferedCards(
          myOfferRows
            .map((row) => {
              const card = offerCardsById.get(row.card_id);
              return card ? { card, offer: offerFromRow(row) } : null;
            })
            .filter((v): v is OfferedCardView => v !== null),
        );
      } else {
        setOfferedCards([]);
      }

      const myQueueRows = (myQueueRes.data as QueueEntryRow[] | null) ?? [];
      if (myQueueRows.length === 0) {
        setQueuedCards([]);
        setLoading(false);
        return;
      }

      const cardIds = myQueueRows.map((r) => r.card_id);
      const [cardsRes, allQueueRes] = await Promise.all([
        supabase.from("cards").select("*").in("id", cardIds),
        supabase
          .from("dibs_queue")
          .select("*")
          .in("card_id", cardIds)
          .eq("status", "WAITING")
          .order("created_at", { ascending: true }),
      ]);

      const cardsById = new Map(
        (((cardsRes.data as CardRow[] | null) ?? []).map((r) => [r.id, cardFromRow(r)]) as [string, CardItem][]),
      );
      const allQueue = ((allQueueRes.data as QueueEntryRow[] | null) ?? []).map(queueEntryFromRow);

      const result: QueuedCardView[] = [];
      for (const cardId of cardIds) {
        const card = cardsById.get(cardId);
        if (!card) continue;
        const group = allQueue.filter((q) => q.cardId === cardId);
        const idx = group.findIndex((q) => q.buyerId === buyer.id);
        result.push({ card, position: idx + 1 });
      }
      setQueuedCards(result);
      setLoading(false);
    });
  }, [buyer]);

  const isEmpty =
    !loading && cards.length === 0 && queuedCards.length === 0 && offeredCards.length === 0;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <h1 className="mb-6 text-2xl font-bold text-foreground">My Dibs {buyer ? `— ${buyer.handle}` : ""}</h1>

      {loading && <p className="text-sm text-foreground-muted">Loading...</p>}

      {isEmpty && (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-card-border py-24 text-center">
          <PackageSearch size={28} className="mb-3 text-foreground-muted" />
          <p className="text-sm text-foreground-muted">You haven&apos;t claimed dibs on any cards yet.</p>
        </div>
      )}

      {(cards.length > 0 || queuedCards.length > 0) && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {cards.map((card) => (
            <div
              key={card.id}
              className="flex flex-col overflow-hidden rounded-2xl border border-card-border bg-card transition-shadow hover:glow-gold"
            >
              <Link href={`/card/${card.id}`}>
                <div className="relative aspect-[3/4] w-full bg-navy-950/5">
                  {card.images[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element -- arbitrary seller-supplied image URLs
                    <img src={card.images[0]} alt={card.title} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-foreground-muted">
                      <ImageOff size={24} />
                    </div>
                  )}
                  <div className="absolute right-2 top-2">
                    <StatusBadge status={card.status} />
                  </div>
                </div>
                <div className="flex flex-col gap-1 p-3">
                  <p className="line-clamp-1 text-sm font-semibold text-foreground">{card.title}</p>
                  <p className="text-sm text-foreground-muted">
                    {card.setName} • {formatCurrency(card.price)}
                  </p>
                </div>
              </Link>
              {card.status === "SOLD" && (
                <div className="px-3 pb-3">
                  <Link
                    href={`/account/disputes/new?cardId=${card.id}`}
                    className="block w-full rounded-lg border border-card-border px-3 py-1.5 text-center text-xs font-medium text-foreground-muted transition-colors hover:border-sold/40 hover:text-sold"
                  >
                    Report an Issue
                  </Link>
                </div>
              )}
            </div>
          ))}

          {queuedCards.map(({ card, position }) => (
            <Link
              key={card.id}
              href={`/card/${card.id}`}
              className="flex flex-col overflow-hidden rounded-2xl border border-card-border bg-card transition-shadow hover:glow-gold"
            >
              <div className="relative aspect-[3/4] w-full bg-navy-950/5">
                {card.images[0] ? (
                  // eslint-disable-next-line @next/next/no-img-element -- arbitrary seller-supplied image URLs
                  <img src={card.images[0]} alt={card.title} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-foreground-muted">
                    <ImageOff size={24} />
                  </div>
                )}
                <div className="absolute right-2 top-2">
                  <span className="flex items-center gap-1 rounded-full bg-pending-bg px-2 py-0.5 text-xs font-semibold text-pending">
                    <Hourglass size={12} />
                    #{position} in queue
                  </span>
                </div>
              </div>
              <div className="flex flex-col gap-1 p-3">
                <p className="line-clamp-1 text-sm font-semibold text-foreground">{card.title}</p>
                <p className="text-sm text-foreground-muted">
                  {card.setName} • {formatCurrency(card.price)}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}

      {offeredCards.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-4 text-lg font-semibold text-foreground">My Offers</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {offeredCards.map(({ card, offer }) => {
              const countered = offer.status === "PENDING" && offer.note?.startsWith(COUNTERED_PREFIX);
              const superseded = offer.status === "SUPERSEDED";
              return (
                <Link
                  key={offer.id}
                  href={`/card/${card.id}`}
                  className={cn(
                    "flex flex-col overflow-hidden rounded-2xl border border-card-border bg-card transition-shadow hover:glow-gold",
                    superseded && "opacity-60",
                  )}
                >
                  <div className="relative aspect-[3/4] w-full bg-navy-950/5">
                    {card.images[0] ? (
                      // eslint-disable-next-line @next/next/no-img-element -- arbitrary seller-supplied image URLs
                      <img src={card.images[0]} alt={card.title} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-foreground-muted">
                        <ImageOff size={24} />
                      </div>
                    )}
                    <div className="absolute right-2 top-2">
                      {offer.status === "ACCEPTED" && (
                        <span className="rounded-full bg-available-bg px-2 py-0.5 text-xs font-semibold text-available">
                          Accepted
                        </span>
                      )}
                      {offer.status === "DECLINED" && (
                        <span className="rounded-full bg-sold-bg px-2 py-0.5 text-xs font-semibold text-sold">
                          Declined
                        </span>
                      )}
                      {superseded && (
                        <span className="rounded-full bg-foreground/5 px-2 py-0.5 text-xs font-semibold text-foreground-muted">
                          Superseded
                        </span>
                      )}
                      {offer.status === "PENDING" && (
                        <span className="rounded-full bg-pending-bg px-2 py-0.5 text-xs font-semibold text-pending">
                          {countered ? `Countered: ${formatCurrency(offer.offeredAmount)}` : "Offer pending"}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 p-3">
                    <p className="line-clamp-1 text-sm font-semibold text-foreground">{card.title}</p>
                    <p className="text-sm text-foreground-muted">
                      Your offer: {formatCurrency(offer.offeredAmount)}
                    </p>
                    {countered && offer.note && (
                      <p className="line-clamp-2 text-xs text-foreground-muted">{offer.note}</p>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
