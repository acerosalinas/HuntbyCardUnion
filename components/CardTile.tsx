"use client";

import Link from "next/link";
import { Heart, ImageOff } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { StatusBadge } from "@/components/StatusBadge";
import { ConditionBadges } from "@/components/ConditionBadges";
import { RarityBadge } from "@/components/RarityBadge";
import { useBuyerIdentity } from "@/components/BuyerIdentityProvider";
import { useWishlist } from "@/hooks/useWishlist";
import { cn, formatCurrency } from "@/lib/utils";
import { CardItem } from "@/types/marketplace";

export function CardTile({ card, isNegotiating = false }: { card: CardItem; isNegotiating?: boolean }) {
  const { buyer } = useBuyerIdentity();
  const { isWishlisted, toggle } = useWishlist();
  const wishlisted = isWishlisted(card.id);
  const isSold = card.status === "SOLD";
  const isLowStock = !isSold && card.quantity > 1 && card.quantityAvailable <= Math.ceil(card.quantity * 0.2);

  return (
    <Link
      href={`/card/${card.id}`}
      className={cn(
        "group flex flex-col overflow-hidden rounded-2xl border transition-shadow",
        isLowStock
          ? "border-pending/40 bg-pending-bg"
          : "border-card-border bg-card hover:glow-gold",
      )}
    >
      <div className="relative aspect-[3/4] w-full overflow-hidden bg-navy-950/5">
        {card.images[0] ? (
          // eslint-disable-next-line @next/next/no-img-element -- arbitrary seller-supplied image URLs, not local assets
          <img
            src={card.images[0]}
            alt={card.title}
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-foreground-muted">
            <ImageOff size={28} />
          </div>
        )}
        <div className="absolute left-2 top-2 flex flex-wrap gap-1.5">
          <ConditionBadges conditionGrade={card.conditionGrade} />
          <RarityBadge rarity={card.rarity} franchise={card.franchise} />
          {card.isFlashSale && <Badge tone="pending">Flash Sale</Badge>}
        </div>
        {buyer && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              toggle(card.id);
            }}
            aria-label={wishlisted ? "Remove from wishlist" : "Save to wishlist"}
            aria-pressed={wishlisted}
            className={cn(
              "absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full backdrop-blur-sm transition-colors",
              wishlisted ? "bg-gold text-navy-950" : "bg-navy-950/60 text-ivory hover:bg-navy-950/80",
            )}
          >
            <Heart size={14} fill={wishlisted ? "currentColor" : "none"} />
          </button>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="line-clamp-1 font-semibold text-foreground">{card.title}</h3>
            <p className="line-clamp-1 text-sm text-foreground-muted">{card.setName}</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <StatusBadge status={card.status} />
            {isNegotiating && !isSold && <Badge tone="gold">Negotiating</Badge>}
          </div>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-lg font-bold text-foreground">{formatCurrency(card.price)}</span>
          <span className="text-xs text-foreground-muted">{card.sellerHandle}</span>
        </div>

        {!isSold && card.quantity > 1 && (
          <div className="rounded-lg bg-background-elevated/60 px-2.5 py-1.5">
            <span className="text-xs text-foreground-muted">
              <span className="font-medium text-foreground">{card.quantityAvailable}</span> of {card.quantity}{" "}
              available
            </span>
          </div>
        )}

        {isSold && (
          <div className="mt-auto rounded-lg bg-sold-bg px-2.5 py-1.5 text-sm font-medium text-sold">Sold Out</div>
        )}
      </div>
    </Link>
  );
}
