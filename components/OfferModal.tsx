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
import { MIN_OFFER_FRACTION, MAX_OFFER_FRACTION, minOfferFor, maxOfferFor } from "@/lib/offerLimits";
import { CardItem } from "@/types/marketplace";

interface OfferModalProps {
  card: CardItem;
  open: boolean;
  onClose: () => void;
  onSubmitted?: () => void;
  /** This seller's configured hold window (seller_profiles.offer_hold_hours) - defaults to 24 (the column's own default) if the seller profile wasn't loaded for some reason. */
  offerHoldHours?: number;
}

export function OfferModal({ card, open, onClose, onSubmitted, offerHoldHours = 24 }: OfferModalProps) {
  const { buyer, loading: identityLoading } = useBuyerIdentity();
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const minOffer = minOfferFor(card.price);
  const maxOffer = maxOfferFor(card.price);

  const offerSchema = z
    .number({ error: "Enter a numeric offer" })
    .positive("Offer must be greater than 0")
    .max(maxOffer, `Offer can't exceed ${formatCurrency(maxOffer)} (${Math.round(MAX_OFFER_FRACTION * 100)}% of listed price)`)
    .min(minOffer, `Offer must be at least ${formatCurrency(minOffer)} (${Math.round(MIN_OFFER_FRACTION * 100)}% of listed price)`);

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
          {formatCurrency(minOffer)} and {formatCurrency(maxOffer)}.
        </p>
        <p className="rounded-lg bg-pending-bg px-3 py-2 text-xs text-pending">
          Submitting an offer puts this card on hold for {offerHoldHours} hour{offerHoldHours === 1 ? "" : "s"},
          exclusively for you - nobody else can offer on or buy it until the seller responds or the hold expires.
        </p>
        <div>
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-foreground-muted">
            Offer amount (₱)
          </label>
          <Input
            type="number"
            inputMode="decimal"
            min={minOffer}
            max={maxOffer}
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
