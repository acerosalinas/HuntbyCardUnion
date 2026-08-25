"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, CheckCircle2, Heart, Hourglass, ImageOff, PackageCheck, ShoppingCart, Store, Truck } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { StatusBadge } from "@/components/StatusBadge";
import { ConditionBadges } from "@/components/ConditionBadges";
import { RarityBadge } from "@/components/RarityBadge";
import { OfferModal } from "@/components/OfferModal";
import { Input } from "@/components/ui/Input";
import { useCart } from "@/components/CartProvider";
import { useBuyerIdentity } from "@/components/BuyerIdentityProvider";
import { useRealtimeCard } from "@/hooks/useRealtimeCard";
import { useCardQueue } from "@/hooks/useCardQueue";
import { useMyClaims } from "@/hooks/useMyClaims";
import { useWishlist } from "@/hooks/useWishlist";
import { useNegotiatingCardIds } from "@/hooks/useNegotiatingCardIds";
import { cn, formatCurrency } from "@/lib/utils";
import { CardItem, FulfillmentMethod, SellerProfile } from "@/types/marketplace";

export function CardDetail({
  initialCard,
  initialSellerProfile,
}: {
  initialCard: CardItem;
  initialSellerProfile?: SellerProfile | null;
}) {
  const card = useRealtimeCard(initialCard);
  const queue = useCardQueue(card.id);
  const myClaims = useMyClaims(card.id);
  const negotiatingCardIds = useNegotiatingCardIds();
  const isNegotiating = negotiatingCardIds.has(card.id);
  const { isInCart, addToCart, removeFromCart } = useCart();
  const { buyer } = useBuyerIdentity();
  const { isWishlisted, toggle: toggleWishlist } = useWishlist();
  const wishlisted = isWishlisted(card.id);
  const [activeImage, setActiveImage] = useState(0);
  const [offerOpen, setOfferOpen] = useState(false);
  const [addedNotice, setAddedNotice] = useState(false);
  const [qty, setQty] = useState(1);
  const [fulfillmentMethod, setFulfillmentMethod] = useState<FulfillmentMethod>("SHIP");

  const inStock = card.quantityAvailable > 0;
  const isSold = card.status === "SOLD";
  const images = card.images;

  const myPendingClaims = myClaims.filter((c) => c.status === "PENDING");
  const myPendingQuantity = myPendingClaims.reduce((sum, c) => sum + c.quantity, 0);
  const myQueueIndex = buyer ? queue.findIndex((q) => q.buyerId === buyer.id) : -1;
  const isQueued = myQueueIndex !== -1;
  const inCart = isInCart(card.id);
  const maxQty = Math.max(1, card.quantityAvailable);

  let cartLabel = inStock ? "Add to Cart" : "Join Waitlist";
  let cartDisabled = false;
  if (isQueued) {
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
    addToCart(card.id, qty, fulfillmentMethod);
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
            <RarityBadge rarity={card.rarity} franchise={card.franchise} />
            {card.isFlashSale && <Badge tone="pending">Flash Sale</Badge>}
            <StatusBadge status={card.status} />
            {isNegotiating && !isSold && <Badge tone="gold">Negotiating</Badge>}
          </div>

          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-foreground">{card.title}</h1>
              <p className="text-foreground-muted">{card.setName}</p>
            </div>
            {buyer && (
              <button
                type="button"
                onClick={() => toggleWishlist(card.id)}
                aria-pressed={wishlisted}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                  wishlisted
                    ? "border-gold bg-gold text-navy-950"
                    : "border-card-border text-foreground-muted hover:border-gold/50 hover:text-foreground",
                )}
              >
                <Heart size={14} fill={wishlisted ? "currentColor" : "none"} />
                {wishlisted ? "Saved" : "Save"}
              </button>
            )}
          </div>

          <div className="flex items-center justify-between border-y border-card-border py-3">
            <div>
              <span className="text-3xl font-bold text-foreground">{formatCurrency(card.price)}</span>
              {card.quantity > 1 && (
                <p className="text-xs text-foreground-muted">
                  {card.quantityAvailable} of {card.quantity} available
                </p>
              )}
            </div>
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

          {(myPendingQuantity > 0 || queue.length > 0) && (
            <div className="flex flex-col gap-1 rounded-xl bg-pending-bg px-4 py-3">
              {myPendingQuantity > 0 && (
                <span className="flex items-center gap-1.5 text-sm font-medium text-available">
                  <CheckCircle2 size={14} />
                  You have dibs on {myPendingQuantity} — complete payment via Messenger.
                </span>
              )}
              {isQueued && (
                <span className="flex items-center gap-1.5 text-sm font-medium text-pending">
                  <Hourglass size={14} />
                  You&apos;re #{myQueueIndex + 1} in queue, waiting for {queue[myQueueIndex].requestedQuantity} unit
                  {queue[myQueueIndex].requestedQuantity === 1 ? "" : "s"}.
                </span>
              )}
              {queue.length > 0 && (
                <span className="text-xs text-foreground-muted">
                  {queue.length} {queue.length === 1 ? "person" : "people"} waiting in queue
                </span>
              )}
            </div>
          )}

          {isSold && (
            <div className="rounded-xl bg-sold-bg px-4 py-3 text-sm font-medium text-sold">Sold Out</div>
          )}

          {addedNotice && (
            <p className="flex items-center gap-1.5 text-sm text-available">
              <ShoppingCart size={14} />
              Added to cart.
            </p>
          )}

          {inStock && card.quantityAvailable > 1 && !inCart && !isQueued && (
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium uppercase tracking-wide text-foreground-muted">Quantity</label>
              <Input
                type="number"
                min={1}
                max={maxQty}
                value={qty}
                onChange={(e) => setQty(Math.max(1, Math.min(maxQty, Number(e.target.value) || 1)))}
                className="w-20"
              />
            </div>
          )}

          {inStock && !inCart && !isQueued && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium uppercase tracking-wide text-foreground-muted">
                Fulfillment
              </label>
              <div className="flex gap-2">
                {(
                  [
                    { key: "SHIP" as const, label: "Ship Out", icon: Truck },
                    { key: "STASH" as const, label: "Stash With Us", icon: PackageCheck },
                  ]
                ).map(({ key, label, icon: Icon }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setFulfillmentMethod(key)}
                    className={cn(
                      "inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                      fulfillmentMethod === key
                        ? "border-gold bg-gold text-navy-950"
                        : "border-card-border text-foreground-muted hover:border-gold/50 hover:text-foreground",
                    )}
                  >
                    <Icon size={14} />
                    {label}
                  </button>
                ))}
              </div>
            </div>
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
              variant={inStock ? "gold" : "disabled"}
              disabled={!inStock}
              onClick={() => setOfferOpen(true)}
            >
              Make Offer
            </Button>
          </div>

          {initialSellerProfile && (
            <Link
              href={`/sellers/${initialSellerProfile.handle}`}
              className="group relative mt-2 overflow-hidden rounded-2xl border border-card-border bg-gradient-to-br from-navy-950 to-gold/10 transition-colors hover:border-gold/50"
            >
              <div className="relative flex items-center gap-4 p-5">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-gold bg-navy-950 text-gold">
                  {initialSellerProfile.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- arbitrary seller-supplied image URL
                    <img src={initialSellerProfile.avatarUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <Store size={24} />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gold">Sold by</p>
                  <p className="truncate text-lg font-bold text-ivory">{initialSellerProfile.displayName}</p>
                  {initialSellerProfile.bio && (
                    <p className="line-clamp-2 text-sm text-ivory/70">{initialSellerProfile.bio}</p>
                  )}
                  {initialSellerProfile.tags.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {initialSellerProfile.tags.slice(0, 3).map((tag) => (
                        <span
                          key={tag}
                          className="rounded-full bg-navy-950/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gold"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <ArrowRight
                  size={18}
                  className="shrink-0 text-gold opacity-0 transition-opacity group-hover:opacity-100"
                />
              </div>
            </Link>
          )}
        </div>
      </div>

      <OfferModal card={card} open={offerOpen} onClose={() => setOfferOpen(false)} />
    </div>
  );
}
