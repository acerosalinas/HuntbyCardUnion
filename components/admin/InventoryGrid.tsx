"use client";

import { useState, useTransition } from "react";
import { ImageOff, Pencil, Trash2 } from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";
import { ConditionBadges } from "@/components/ConditionBadges";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EditListingModal } from "@/components/admin/EditListingModal";
import { useNegotiatingCardIds } from "@/hooks/useNegotiatingCardIds";
import { cn, formatCurrency } from "@/lib/utils";
import { getFranchiseBySlug } from "@/lib/franchises";
import { CardItem } from "@/types/marketplace";
import { deleteCard } from "@/app/admin/actions";

/** Tile view of InventoryList - same data and actions (edit/remove), laid out as image-first cards instead of a text table. */
export function InventoryGrid({ cards }: { cards: CardItem[] }) {
  const negotiatingCardIds = useNegotiatingCardIds();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingCard, setEditingCard] = useState<CardItem | null>(null);

  const handleRemove = (card: CardItem) => {
    if (!window.confirm(`Remove "${card.title}" from listings? This can't be undone.`)) return;
    setError(null);
    setBusyId(card.id);
    startTransition(async () => {
      try {
        await deleteCard(card.id);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to remove listing");
      } finally {
        setBusyId(null);
      }
    });
  };

  if (cards.length === 0) {
    return <p className="py-10 text-center text-sm text-foreground-muted">No listings yet.</p>;
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-sm text-sold">{error}</p>}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {cards.map((card) => {
          const busy = pending && busyId === card.id;
          return (
            <div
              key={card.id}
              className={cn(
                "flex flex-col overflow-hidden rounded-2xl border bg-card",
                busy ? "opacity-60" : "border-card-border",
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
                <div className="absolute left-2 top-2 flex flex-wrap gap-1.5">
                  <ConditionBadges conditionGrade={card.conditionGrade} />
                </div>
                <div className="absolute right-2 top-2 flex flex-col items-end gap-1">
                  <StatusBadge status={card.status} />
                  {negotiatingCardIds.has(card.id) && card.status !== "SOLD" && (
                    <Badge tone="gold">Negotiating</Badge>
                  )}
                </div>
              </div>

              <div className="flex flex-1 flex-col gap-1 p-3">
                <p className="line-clamp-1 text-sm font-semibold text-foreground">{card.title}</p>
                <p className="line-clamp-1 text-xs text-foreground-muted">
                  {card.franchise ? (getFranchiseBySlug(card.franchise)?.label ?? card.franchise) : card.setName}
                </p>
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-sm font-bold text-foreground">{formatCurrency(card.price)}</span>
                  <span className="text-xs text-foreground-muted">{card.sellerHandle}</span>
                </div>
                <span className="text-xs text-foreground-muted">
                  Stock: {card.quantityAvailable} / {card.quantity}
                </span>
              </div>

              <div className="flex gap-2 p-3 pt-0">
                <Button variant="outline" disabled={busy} onClick={() => setEditingCard(card)} className="flex-1">
                  <Pencil size={14} />
                  Edit
                </Button>
                <Button variant="danger" disabled={busy} onClick={() => handleRemove(card)} className="flex-1">
                  <Trash2 size={14} />
                  Remove
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <EditListingModal card={editingCard} onClose={() => setEditingCard(null)} />
    </div>
  );
}
