"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, ImageOff, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useCart } from "@/components/CartProvider";
import { tileMeta } from "@/components/CardTile";
import { formatCurrency } from "@/lib/utils";
import { CardItem } from "@/types/marketplace";

/**
 * A closer look at a card without leaving the page you were browsing: big photo, price, what it is, and a one-tap Add to Cart.
 * Cards that need a choice first (a Fun Mystery Pack's number) or can't be bought right now point to the full card page instead.
 */
export function QuickLook({ card, onClose }: { card: CardItem; onClose: () => void }) {
  const { addToCart, isInCart } = useCart();
  const [added, setAdded] = useState(false);
  const inCart = added || isInCart(card.id);
  const meta = tileMeta(card);
  const held = card.holdingOfferId !== null;
  const available = card.quantityAvailable > 0 && card.status !== "SOLD" && !held;
  const needsChoice = card.productType === "MYSTERY";

  return (
    <Modal open onClose={onClose} title={card.title} className="max-w-md">
      <div className="space-y-4">
        <div className="flex max-h-[55vh] min-h-48 items-center justify-center overflow-hidden rounded-xl border border-card-border bg-navy-950/5">
          {card.images[0] ? (
            // eslint-disable-next-line @next/next/no-img-element -- arbitrary seller-supplied image URLs, not local assets
            <img src={card.images[0]} alt={card.title} className="max-h-[55vh] w-auto max-w-full object-contain" />
          ) : (
            <ImageOff size={32} className="text-foreground-muted" aria-hidden="true" />
          )}
        </div>

        <div className="space-y-1">
          <p className="text-2xl font-bold tabular-nums text-gold-ink">{formatCurrency(card.price)}</p>
          {meta && <p className="text-sm text-foreground-muted">{meta}</p>}
          <p className="text-xs text-foreground-muted">
            {card.sellerHandle}
            {card.quantity > 1 && available && ` · ${card.quantityAvailable} of ${card.quantity} available`}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {available && !needsChoice ? (
            inCart ? (
              <Link href="/cart" className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-gold bg-gold/15 px-4 py-2 text-sm font-semibold text-foreground">
                <Check size={15} aria-hidden="true" /> In your cart · View cart
              </Link>
            ) : (
              <Button
                variant="gold"
                type="button"
                className="flex-1"
                onClick={() => {
                  addToCart(card.id, 1, "SHIP", "PREPAID");
                  setAdded(true);
                }}
              >
                <ShoppingCart size={15} aria-hidden="true" /> Add to Cart
              </Button>
            )
          ) : (
            <p className="flex-1 rounded-lg bg-foreground/5 px-3 py-2 text-sm text-foreground-muted">
              {needsChoice ? "Pick your number on the card page." : held ? "On hold - another buyer is negotiating on it." : "Not available right now."}
            </p>
          )}
          <Link
            href={`/card/${card.id}`}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-card-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-gold/60"
          >
            {needsChoice ? "Choose a pack" : "Full details"} <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </div>
        {available && !needsChoice && !inCart && <p className="text-xs text-foreground-muted">Added to ship out. You can switch to Stash With Us, or pay on delivery, on the card page or in your cart.</p>}
      </div>
    </Modal>
  );
}
