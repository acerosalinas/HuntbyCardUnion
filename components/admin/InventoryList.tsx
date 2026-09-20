"use client";

import { useState, useTransition } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";
import { ConditionBadges } from "@/components/ConditionBadges";
import { SealedTypeBadge } from "@/components/SealedTypeBadge";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EditListingModal } from "@/components/admin/EditListingModal";
import { useNegotiatingCardIds } from "@/hooks/useNegotiatingCardIds";
import { cn, extractErrorMessage, formatCurrency } from "@/lib/utils";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { getFranchiseBySlug } from "@/lib/franchises";
import { CardItem } from "@/types/marketplace";
import { deleteCard } from "@/app/admin/actions";

export function InventoryList({
  cards,
  selectedIds,
  onToggle,
}: {
  cards: CardItem[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
}) {
  const negotiatingCardIds = useNegotiatingCardIds();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingCard, setEditingCard] = useState<CardItem | null>(null);
  const confirm = useConfirm();

  const handleRemove = async (card: CardItem) => {
    const confirmed = await confirm({
      title: "Remove listing",
      message: `Remove "${card.title}" from listings? This can't be undone.`,
      confirmLabel: "Remove",
      tone: "danger",
    });
    if (!confirmed) return;
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
              <th className="w-10 px-4 py-3">
                <span className="sr-only">Select</span>
              </th>
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
              <tr key={card.id} className={cn("border-t border-card-border", selectedIds.has(card.id) && "bg-gold/10")}>
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(card.id)}
                    onChange={() => onToggle(card.id)}
                    aria-label={`Select ${card.title}`}
                    className="h-4 w-4 rounded border-card-border accent-gold"
                  />
                </td>
                <td className="px-4 py-3 font-medium">{card.title}</td>
                <td className="px-4 py-3 text-foreground-muted">
                  {card.franchise ? (getFranchiseBySlug(card.franchise)?.label ?? card.franchise) : "—"}
                </td>
                <td className="px-4 py-3 text-foreground-muted">{card.setName}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1.5">
                    {card.productType === "SEALED" ? (
                      <SealedTypeBadge sealedType={card.sealedType} />
                    ) : (
                      <ConditionBadges conditionGrade={card.conditionGrade} />
                    )}
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
