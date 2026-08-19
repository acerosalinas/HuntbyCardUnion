"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Hourglass, ImageOff, ShoppingCart, Store } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { StatusBadge } from "@/components/StatusBadge";
import { ConditionBadges } from "@/components/ConditionBadges";
import { OfferModal } from "@/components/OfferModal";
import { useCart } from "@/components/CartProvider";
import { useBuyerIdentity } from "@/components/BuyerIdentityProvider";
import { useRealtimeCard } from "@/hooks/useRealtimeCard";
import { useCardQueue } from "@/hooks/useCardQueue";
import { useNegotiatingCardIds } from "@/hooks/useNegotiatingCardIds";
import { cn, formatCurrency } from "@/lib/utils";
import { CardItem, SellerProfile } from "@/types/marketplace";

export function CardDetail({
  initialCard,
  initialSellerProfile,
}: {
  initialCard: CardItem;
  initialSellerProfile?: SellerProfile | null;
}) {
  const card = useRealtimeCard(initialCard);
  const queue = useCardQueue(card.id);
  const negotiatingCardIds = useNegotiatingCardIds();
  const isNegotiating = negotiatingCardIds.has(card.id);
  const { isInCart, addToCart, removeFromCart } = useCart();
  const { buyer } = useBuyerIdentity();
  const [activeImage, setActiveImage] = useState(0);
  const [offerOpen, setOfferOpen] = useState(false);
  const [addedNotice, setAddedNotice] = useState(false);

  const isAvailable = card.status === "AVAILABLE";
  const isPending = card.status === "PENDING";
  const isSold = card.status === "SOLD";
  const images = card.images;

  const isMyClaim = isPending && buyer !== null && card.claimantId === buyer.id;
  const myQueueIndex = buyer ? queue.findIndex((q) => q.buyerId === buyer.id) : -1;
  const isQueued = myQueueIndex !== -1;
  const inCart = isInCart(card.id);

  let cartLabel = "Add to Cart";
  let cartDisabled = false;
  if (isSold) {
    cartLabel = "Sold";
    cartDisabled = true;
  } else if (isMyClaim) {
    cartLabel = "You Have Dibs";
    cartDisabled = true;
  } else if (isQueued) {
    cartLabel = "In Queue";
    cartDisabled = true;
  } else if (inCart) {
    cartLabel = "Remove from Cart";
  }

  const handleCartToggle = () => {
    if (cartDisabled) return;
    if (inCart) {
      removeFromCart(card.id);
      return;
    }
    addToCart(card.id);
    setAddedNotice(true);
    setTimeout(() => setAddedNotice(false), 3000);
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <Link
        href={card.franchise ? `/${card.franchise}` : "/"}
        className="mb-5 inline-flex items-center gap-1.5 text-sm text-foreground-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft size={16} />
        Back to Marketplace
      </Link>

      <div className="grid gap-8 md:grid-cols-2">
        <div>
          <div className="relative aspect-[3/4] w-full overflow-hidden rounded-2xl border border-card-border bg-navy-950/5">
            {images[activeImage] ? (
              // eslint-disable-next-line @next/next/no-img-element -- arbitrary seller-supplied image URLs, not local assets
              <img src={images[activeImage]} alt={card.title} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-foreground-muted">
                <ImageOff size={40} />
              </div>
            )}
          </div>
          {images.length > 1 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {images.map((url, i) => (
                <button
                  key={url}
                  type="button"
                  onClick={() => setActiveImage(i)}
                  className={cn(
                    "h-16 w-16 shrink-0 overflow-hidden rounded-lg border-2 transition-colors",
                    i === activeImage
                      ? "border-gold"
                      : "border-card-border opacity-70 hover:opacity-100",
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary seller-supplied image URLs, not local assets */}
                  <img src={url} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <ConditionBadges conditionGrade={card.conditionGrade} />
            {card.isFlashSale && <Badge tone="pending">Flash Sale</Badge>}
            <StatusBadge status={card.status} />
            {isNegotiating && !isSold && <Badge tone="gold">Negotiating</Badge>}
          </div>

          <div>
            <h1 className="text-2xl font-bold text-foreground">{card.title}</h1>
            <p className="text-foreground-muted">{card.setName}</p>
          </div>

          <div className="flex items-center justify-between border-y border-card-border py-3">
            <span className="text-3xl font-bold text-foreground">{formatCurrency(card.price)}</span>
            {initialSellerProfile ? (
              <Link
                href={`/sellers/${initialSellerProfile.handle}`}
                className="flex items-center gap-1.5 text-sm text-foreground-muted transition-colors hover:text-gold"
              >
                <span className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-full border border-gold/40 bg-navy-950 text-gold">
                  {initialSellerProfile.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- arbitrary seller-supplied image URL
                    <img src={initialSellerProfile.avatarUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <Store size={12} />
                  )}
                </span>
                Owner: {initialSellerProfile.displayName}
              </Link>
            ) : (
              <span className="text-sm text-foreground-muted">Seller: {card.sellerHandle}</span>
            )}
          </div>

          {isPending && (
            <div className="flex flex-col gap-1 rounded-xl bg-pending-bg px-4 py-3">
              {card.currentClaimant && (
                <span className="text-sm text-foreground-muted">
                  Claimed by <span className="font-medium text-foreground">{card.currentClaimant}</span>
                </span>
              )}
              {queue.length > 0 && (
                <span className="text-xs text-foreground-muted">
                  {queue.length} {queue.length === 1 ? "person" : "people"} waiting in queue
                </span>
              )}
              {isMyClaim && (
                <span className="flex items-center gap-1.5 text-sm font-medium text-available">
                  <CheckCircle2 size={14} />
                  You have dibs — complete payment via Messenger.
                </span>
              )}
              {isQueued && !isMyClaim && (
                <span className="flex items-center gap-1.5 text-sm font-medium text-pending">
                  <Hourglass size={14} />
                  You&apos;re #{myQueueIndex + 1} in queue for this card.
                </span>
              )}
            </div>
          )}

          {isSold && (
            <div className="rounded-xl bg-sold-bg px-4 py-3 text-sm font-medium text-sold">
              SOLD {card.currentClaimant ? `TO ${card.currentClaimant}` : ""}
            </div>
          )}

          {addedNotice && (
            <p className="flex items-center gap-1.5 text-sm text-available">
              <ShoppingCart size={14} />
              Added to cart.
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Button
              variant={cartDisabled ? "disabled" : inCart ? "outline" : "primary"}
              disabled={cartDisabled}
              onClick={handleCartToggle}
            >
              <ShoppingCart size={15} />
              {cartLabel}
            </Button>
            <Button
              variant={isAvailable ? "gold" : "disabled"}
              disabled={!isAvailable}
              onClick={() => setOfferOpen(true)}
            >
              Make Offer
            </Button>
          </div>
        </div>
      </div>

      <OfferModal card={card} open={offerOpen} onClose={() => setOfferOpen(false)} />
    </div>
  );
}
