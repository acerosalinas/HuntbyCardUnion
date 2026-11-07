"use client";

import Link from "next/link";
import { Heart, ImageOff } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { StatusBadge } from "@/components/StatusBadge";
import { SealedTypeBadge } from "@/components/SealedTypeBadge";
import { parseConditionGrade } from "@/lib/conditionGrade";
import { useBuyerIdentity } from "@/components/BuyerIdentityProvider";
import { useWishlist } from "@/hooks/useWishlist";
import { cn, formatCurrency, hasKnownSet } from "@/lib/utils";
import { CardItem } from "@/types/marketplace";

/** One quiet line under the title: condition or grade, then the set when we know it. Placeholder values ("Unknown Set", rarity "Other") say nothing and are left out. */
function tileMeta(card: CardItem): string {
  const parts: string[] = [];
  if (card.productType !== "SEALED") {
    const parsed = parseConditionGrade(card.conditionGrade);
    parts.push(parsed.type === "RAW" ? `Raw ${parsed.condition}` : `${parsed.grader} ${parsed.gradeNumber}`);
    if (card.rarity && card.rarity !== "Other") parts.push(card.rarity);
  }
  if (hasKnownSet(card.setName)) parts.push(card.setName);
  return parts.join(" · ");
}

export function CardTile({
  card,
  isNegotiating = false,
  decorative = false,
}: {
  card: CardItem;
  isNegotiating?: boolean;
  /** A repeated copy of a tile (the second half of a looping row): still clickable, but skipped by keyboard tabbing. Pair it with aria-hidden on the wrapper. */
  decorative?: boolean;
}) {
  const { buyer } = useBuyerIdentity();
  const { isWishlisted, toggle } = useWishlist();
  const wishlisted = isWishlisted(card.id);
  const isSold = card.status === "SOLD";
  const meta = tileMeta(card);
  const isLowStock = !isSold && card.quantity > 1 && card.quantityAvailable <= Math.ceil(card.quantity * 0.2);

  return (
    <Link
      href={`/card/${card.id}`}
      tabIndex={decorative ? -1 : undefined}
      className={cn(
        "group flex flex-col overflow-hidden rounded-2xl border outline-none transition-[transform,box-shadow,border-color] duration-200 ease-out",
        "focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "motion-safe:hover:-translate-y-0.5 hover:shadow-[0_14px_28px_-14px_rgba(11,19,43,0.45)]",
        isLowStock
          ? "border-pending/40 bg-pending-bg"
          : "border-card-border bg-card hover:border-gold/50",
      )}
    >
      <div className="relative aspect-3/4 w-full overflow-hidden bg-navy-950/5">
        {card.images[0] ? (
          // eslint-disable-next-line @next/next/no-img-element -- arbitrary seller-supplied image URLs, not local assets
          <img
            src={card.images[0]}
            alt={card.title}
            loading="lazy"
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 ease-out motion-safe:group-hover:scale-[1.04]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-foreground-muted">
            <ImageOff size={28} />
          </div>
        )}
        {(card.isFlashSale || card.productType === "SEALED") && (
          <div className={cn("absolute left-2 top-2 flex flex-wrap gap-1.5", buyer ? "right-11" : "right-2")}>
            {card.productType === "SEALED" && <SealedTypeBadge sealedType={card.sealedType} />}
            {card.isFlashSale && <Badge tone="pending">Flash Sale</Badge>}
          </div>
        )}
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
            tabIndex={decorative ? -1 : undefined}
            className={cn(
              "absolute right-1.5 top-1.5 flex h-9 w-9 items-center justify-center rounded-full backdrop-blur-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
              wishlisted ? "bg-gold text-navy-950" : "bg-navy-950/60 text-ivory hover:bg-navy-950/80",
            )}
          >
            <Heart size={14} fill={wishlisted ? "currentColor" : "none"} />
          </button>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1.5 p-3 sm:p-3.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xl font-bold tabular-nums text-gold-ink">{formatCurrency(card.price)}</span>
          {/* card.holdingOfferId (see migration_offer_hold.sql) covers the full hold - PENDING, COUNTERED, and ACCEPTED - a broader signal than the isNegotiating prop's PENDING-only one, so either firing is enough. */}
          {(isNegotiating || card.holdingOfferId !== null) && !isSold ? (
            <Badge tone="gold">On Hold</Badge>
          ) : (
            card.status !== "AVAILABLE" && <StatusBadge status={card.status} />
          )}
        </div>
        <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-foreground">{card.title}</h3>
        {meta && <p className="line-clamp-1 text-xs text-foreground-muted">{meta}</p>}
        <p className="line-clamp-1 text-xs text-foreground-muted/80">{card.sellerHandle}</p>

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
