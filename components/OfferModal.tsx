"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { Modal } from "@/components/ui/Modal";
import { Input, Textarea } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { useBuyerIdentity } from "@/components/BuyerIdentityProvider";
import { createClient } from "@/lib/supabase/client";
import { extractErrorMessage, formatCurrency } from "@/lib/utils";
import { CardItem } from "@/types/marketplace";

interface OfferModalProps {
  card: CardItem;
  open: boolean;
  onClose: () => void;
  onSubmitted?: () => void;
}

export function OfferModal({ card, open, onClose, onSubmitted }: OfferModalProps) {
  const { buyer, loading: identityLoading } = useBuyerIdentity();
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const minOffer = Math.ceil(card.price * 0.85);

  const offerSchema = z
    .number({ error: "Enter a numeric offer" })
    .positive("Offer must be greater than 0")
    .max(card.price, `Offer can't exceed the listed price of ${formatCurrency(card.price)}`)
    .min(minOffer, `Offer must be at least ${formatCurrency(minOffer)} (85% of listed price)`);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    const parsed = offerSchema.safeParse(Number(amount));
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid offer");
      return;
    }

    if (identityLoading) return;
    if (!buyer) {
      onClose();
      router.push(`/account/login?from=${encodeURIComponent(`/card/${card.id}`)}`);
      return;
    }

    setSubmitting(true);
    try {
      const supabase = createClient();
      const { error: rpcError } = await supabase.rpc("submit_offer", {
        p_card_id: card.id,
        p_offered_amount: parsed.data,
        p_note: note || null,
      });
      if (rpcError) throw rpcError;

      setAmount("");
      setNote("");
      onSubmitted?.();
      onClose();
    } catch (err) {
      setError(extractErrorMessage(err) ?? "Failed to submit offer");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Make an offer — ${card.title}`}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-sm text-foreground-muted">
          Listed at {formatCurrency(card.price)}. Offers must be between{" "}
          {formatCurrency(minOffer)} and {formatCurrency(card.price)}.
        </p>
        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-foreground-muted">
            Offer amount (₱)
          </label>
          <Input
            type="number"
            inputMode="decimal"
            min={minOffer}
            max={card.price}
            step="0.01"
            placeholder={String(minOffer)}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-foreground-muted">
            Note (optional)
          </label>
          <Textarea
            rows={3}
            placeholder="e.g. Can pay instantly via GCash"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        {error && <p className="text-sm text-sold">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="gold" disabled={submitting || identityLoading}>
            {identityLoading ? "Loading..." : submitting ? "Submitting..." : "Submit Offer"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
