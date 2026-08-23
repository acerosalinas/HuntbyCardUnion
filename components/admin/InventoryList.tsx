"use client";

import { useState, useTransition } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";
import { ConditionBadges } from "@/components/ConditionBadges";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EditListingModal } from "@/components/admin/EditListingModal";
import { useNegotiatingCardIds } from "@/hooks/useNegotiatingCardIds";
import { extractErrorMessage, formatCurrency } from "@/lib/utils";
import { getFranchiseBySlug } from "@/lib/franchises";
import { CardItem } from "@/types/marketplace";
import { deleteCard } from "@/app/admin/actions";

export function InventoryList({ cards }: { cards: CardItem[] }) {
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
        setError(extractErrorMessage(err) ?? "Failed to remove listing");
      } finally {
        setBusyId(null);
      }
    });
  };

  if (cards.length === 0) {
    return <p className="py-10 text-center text-sm text-foreground-muted">No listings yet.</p>;
  }

  return (
    <div className="space-y-2">
      {error && <p className="text-sm text-sold">{error}</p>}
      <div className="overflow-x-auto rounded-2xl border border-card-border">
        <table className="w-full min-w-180 text-left text-sm">
          <thead className="bg-card text-xs uppercase tracking-wide text-foreground-muted">
            <tr>
              <th className="px-4 py-3">Title</th>
              <th className="px-4 py-3">Franchise</th>
              <th className="px-4 py-3">Set</th>
              <th className="px-4 py-3">Grade</th>
              <th className="px-4 py-3">Price</th>
              <th className="px-4 py-3">Stock</th>
              <th className="px-4 py-3">Seller</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {cards.map((card) => (
              <tr key={card.id} className="border-t border-card-border">
                <td className="px-4 py-3 font-medium">{card.title}</td>
                <td className="px-4 py-3 text-foreground-muted">
                  {card.franchise ? (getFranchiseBySlug(card.franchise)?.label ?? card.franchise) : "—"}
                </td>
                <td className="px-4 py-3 text-foreground-muted">{card.setName}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1.5">
                    <ConditionBadges conditionGrade={card.conditionGrade} />
                  </div>
                </td>
                <td className="px-4 py-3">{formatCurrency(card.price)}</td>
                <td className="px-4 py-3 text-foreground-muted">
                  {card.quantityAvailable} / {card.quantity}
                </td>
                <td className="px-4 py-3 text-foreground-muted">{card.sellerHandle}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1.5">
                    <StatusBadge status={card.status} />
                    {negotiatingCardIds.has(card.id) && card.status !== "SOLD" && (
                      <Badge tone="gold">Negotiating</Badge>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setEditingCard(card)}>
                      <Pencil size={14} />
                      Edit
                    </Button>
                    <Button
                      variant="danger"
                      disabled={pending && busyId === card.id}
                      onClick={() => handleRemove(card)}
                    >
                      <Trash2 size={14} />
                      Remove
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <EditListingModal card={editingCard} onClose={() => setEditingCard(null)} />
    </div>
  );
}
