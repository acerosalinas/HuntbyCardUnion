"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Banknote, Hourglass, ImageOff, PackageCheck, PackageSearch, QrCode, Truck, Wallet } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { LogoSpinner } from "@/components/LogoSpinner";
import { ClaimStageTracker, ClaimStage } from "@/components/ClaimStageTracker";
import { useBuyerIdentity } from "@/components/BuyerIdentityProvider";
import { useCart } from "@/components/CartProvider";
import { requestShipping } from "@/app/account/actions";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { buildMessengerUrl, cn, extractErrorMessage, formatCurrency } from "@/lib/utils";
import {
  CardItem,
  CardOffer,
  CardRow,
  OfferRow,
  cardFromRow,
  offerFromRow,
  QueueEntryRow,
  queueEntryFromRow,
  ClaimStatus,
  FulfillmentMethod,
  PaymentMethod,
} from "@/types/marketplace";

interface ClaimedCardView {
  claimId: string;
  card: CardItem;
  quantity: number;
  status: ClaimStatus;
  shipped: boolean;
  receivedAt: number | null;
  fulfillmentMethod: FulfillmentMethod;
  paymentMethod: PaymentMethod;
  shipRequestedAt: number | null;
}

function claimStage(c: ClaimedCardView): ClaimStage {
  if (c.status === "PENDING") return "PENDING_PAYMENT";
  if (c.receivedAt) return "RECEIVED";
  if (c.shipped) return "SHIPPED";
  return "PAID";
}

interface QueuedCardView {
  card: CardItem;
  position: number;
  requestedQuantity: number;
  lockedPrice: number | null;
}

interface OfferedCardView {
  card: CardItem;
  offer: CardOffer;
}

interface ClaimJoinRow {
  id: string;
  quantity: number;
  status: ClaimStatus;
  shipped: boolean;
  received_at: string | null;
  fulfillment_method: FulfillmentMethod;
  payment_method: PaymentMethod;
  ship_requested_at: string | null;
  cards: CardRow | null;
}

export function MyDibsContents() {
  const { buyer } = useBuyerIdentity();
  const { addToCart, isInCart } = useCart();
  const [claims, setClaims] = useState<ClaimedCardView[]>([]);
  // Seller QR codes for still-unpaid claims - keyed by admin_id so the QR
  // stays reachable here for as long as payment is pending, instead of only
  // ever showing once on the cart's order-confirmation screen (which is
  // easy to navigate away from and lose).
  const [qrByAdminId, setQrByAdminId] = useState<Map<string, string>>(new Map());
  // Whether an accepted offer's seller accepts Cash on Delivery - drives
  // whether the compact Pay Now/COD toggle shows on that offer's tile below.
  const [codEnabledByAdminId, setCodEnabledByAdminId] = useState<Map<string, boolean>>(new Map());
  const [queuedCards, setQueuedCards] = useState<QueuedCardView[]>([]);
  const [offeredCards, setOfferedCards] = useState<OfferedCardView[]>([]);
  const [reviewedClaimIds, setReviewedClaimIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [busyClaimId, setBusyClaimId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // All negotiation actions (accept/decline a counter, add an accepted
  // offer to cart) happen right here on the My Offers tiles now, instead of
  // requiring a trip to each card's own page - see CardDetail.tsx, which
  // now just links back here instead of duplicating these controls.
  const [offerFulfillment, setOfferFulfillment] = useState<Record<string, FulfillmentMethod>>({});
  const [offerPayment, setOfferPayment] = useState<Record<string, PaymentMethod>>({});
  const [offerBusyId, setOfferBusyId] = useState<string | null>(null);
  const [offerErrorById, setOfferErrorById] = useState<Record<string, string>>({});
  const [addedOfferId, setAddedOfferId] = useState<string | null>(null);

  useEffect(() => {
    if (!buyer || !isSupabaseConfigured()) return;
    setLoading(true);
    setLoadError(null);
    const supabase = createClient();

    const load = () => {
    Promise.all([
      supabase
        .from("card_claims")
        .select("id, quantity, status, shipped, received_at, fulfillment_method, payment_method, ship_requested_at, cards(*)")
        .eq("buyer_id", buyer.id)
        .in("status", ["PENDING", "SOLD"]),
      supabase.from("dibs_queue").select("*").eq("buyer_id", buyer.id).eq("status", "WAITING"),
      supabase.from("offers").select("*").eq("buyer_id", buyer.id).order("created_at", { ascending: false }),
      supabase.from("reviews").select("claim_id").eq("buyer_id", buyer.id),
    ]).then(async ([claimedRes, myQueueRes, myOffersRes, reviewsRes]) => {
      const mappedClaims = ((claimedRes.data as unknown as ClaimJoinRow[] | null) ?? [])
        .filter((row): row is ClaimJoinRow & { cards: CardRow } => row.cards !== null)
        .map((row) => ({
          claimId: row.id,
          card: cardFromRow(row.cards),
          quantity: row.quantity,
          status: row.status,
          shipped: row.shipped,
          receivedAt: row.received_at ? new Date(row.received_at).getTime() : null,
          fulfillmentMethod: row.fulfillment_method,
          paymentMethod: row.payment_method,
          shipRequestedAt: row.ship_requested_at ? new Date(row.ship_requested_at).getTime() : null,
        }));
      setClaims(mappedClaims);

      // Only prepaid claims still awaiting payment need a QR - COD claims
      // pay cash on delivery, nothing to scan.
      const unpaidAdminIds = [
        ...new Set(
          mappedClaims
            .filter((c) => c.status === "PENDING" && c.paymentMethod === "PREPAID")
            .map((c) => c.card.adminId)
            .filter((id): id is string => Boolean(id)),
        ),
      ];
      if (unpaidAdminIds.length > 0) {
        const { data: profiles } = await supabase
          .from("seller_profiles")
          .select("admin_id, payment_qr_url")
          .in("admin_id", unpaidAdminIds);
        setQrByAdminId(
          new Map(
            ((profiles ?? []) as { admin_id: string; payment_qr_url: string | null }[])
              .filter((p) => p.payment_qr_url)
              .map((p) => [p.admin_id, p.payment_qr_url as string]),
          ),
        );
      } else {
        setQrByAdminId(new Map());
      }

      setReviewedClaimIds(
        new Set(((reviewsRes.data as { claim_id: string }[] | null) ?? []).map((r) => r.claim_id)),
      );

      const myOfferRows = (myOffersRes.data as OfferRow[] | null) ?? [];
      if (myOfferRows.length > 0) {
        const offerCardIds = [...new Set(myOfferRows.map((r) => r.card_id))];
        const { data: offerCardsData } = await supabase.from("cards").select("*").in("id", offerCardIds);
        const offerCardsById = new Map(
          (((offerCardsData as CardRow[] | null) ?? []).map((r) => [r.id, cardFromRow(r)]) as [string, CardItem][]),
        );
        setOfferedCards(
          myOfferRows
            .map((row) => {
              const card = offerCardsById.get(row.card_id);
              return card ? { card, offer: offerFromRow(row) } : null;
            })
            .filter((v): v is OfferedCardView => v !== null),
        );

        // Only accepted offers can reach the compact Add to Cart controls
        // below, so this is the only case that needs to know whether COD
        // is on the table for that seller.
        const codAdminIds = [
          ...new Set(
            myOfferRows
              .filter((r) => r.status === "ACCEPTED")
              .map((r) => offerCardsById.get(r.card_id)?.adminId)
              .filter((id): id is string => Boolean(id)),
          ),
        ];
        if (codAdminIds.length > 0) {
          const { data: codProfiles } = await supabase
            .from("seller_profiles")
            .select("admin_id, cod_enabled")
            .in("admin_id", codAdminIds);
          setCodEnabledByAdminId(
            new Map(
              ((codProfiles ?? []) as { admin_id: string; cod_enabled: boolean }[]).map((p) => [
                p.admin_id,
                p.cod_enabled,
              ]),
            ),
          );
        } else {
          setCodEnabledByAdminId(new Map());
        }
      } else {
        setOfferedCards([]);
        setCodEnabledByAdminId(new Map());
      }

      const myQueueRows = (myQueueRes.data as QueueEntryRow[] | null) ?? [];
      if (myQueueRows.length === 0) {
        setQueuedCards([]);
        setLoading(false);
        return;
      }

      const cardIds = myQueueRows.map((r) => r.card_id);
      const [cardsRes, allQueueRes] = await Promise.all([
        supabase.from("cards").select("*").in("id", cardIds),
        supabase
          .from("dibs_queue")
          .select("*")
          .in("card_id", cardIds)
          .eq("status", "WAITING")
          .order("created_at", { ascending: true }),
      ]);

      const cardsById = new Map(
        (((cardsRes.data as CardRow[] | null) ?? []).map((r) => [r.id, cardFromRow(r)]) as [string, CardItem][]),
      );
      const allQueue = ((allQueueRes.data as QueueEntryRow[] | null) ?? []).map(queueEntryFromRow);

      const result: QueuedCardView[] = [];
      for (const row of myQueueRows) {
        const card = cardsById.get(row.card_id);
        if (!card) continue;
        const group = allQueue.filter((q) => q.cardId === row.card_id);
        const idx = group.findIndex((q) => q.buyerId === buyer.id);
        result.push({
          card,
          position: idx + 1,
          requestedQuantity: row.requested_quantity,
          lockedPrice: row.locked_price,
        });
      }
      setQueuedCards(result);
      setLoading(false);
    })
    .catch((err) => {
      setLoadError(extractErrorMessage(err) ?? "Failed to load My Dibs - check your connection and try again.");
      setLoading(false);
    });
    };

    load();

    // My Offers used to only fetch once on mount, which is exactly how a
    // buyer could accept/decline a counter and still see stale data here
    // until a manual refresh - subscribed live now, same as every other
    // section on this page.
    const channel = supabase
      .channel(`my-offers-${buyer.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "offers", filter: `buyer_id=eq.${buyer.id}` },
        load,
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [buyer]);

  const handleCancel = async (claim: ClaimedCardView) => {
    if (!buyer) return;
    if (!window.confirm(`Cancel your dibs on "${claim.card.title}"? This can't be undone.`)) return;
    setActionError(null);
    setBusyClaimId(claim.claimId);
    try {
      const supabase = createClient();
      const { error } = await supabase.rpc("cancel_claim", { p_claim_id: claim.claimId });
      if (error) throw error;
      setClaims((prev) => prev.filter((c) => c.claimId !== claim.claimId));

      const message = `Hi! I had to cancel my dibs on "${claim.card.title}" - just letting you know directly. — ${buyer.fullName} (${buyer.handle})`;
      try {
        await navigator.clipboard.writeText(message);
      } catch {
        // Non-fatal - the Messenger tab still opens below.
      }
      window.open(buildMessengerUrl(claim.card.sellerMessenger, message), "_blank", "noopener,noreferrer");
    } catch (err) {
      setActionError(extractErrorMessage(err) ?? "Failed to cancel");
    } finally {
      setBusyClaimId(null);
    }
  };

  const handleMarkReceived = async (claim: ClaimedCardView) => {
    setActionError(null);
    setBusyClaimId(claim.claimId);
    try {
      const supabase = createClient();
      const { error } = await supabase.rpc("mark_claim_received", { p_claim_id: claim.claimId });
      if (error) throw error;
      setClaims((prev) =>
        prev.map((c) => (c.claimId === claim.claimId ? { ...c, receivedAt: Date.now() } : c)),
      );
    } catch (err) {
      setActionError(extractErrorMessage(err) ?? "Failed to update");
    } finally {
      setBusyClaimId(null);
    }
  };

  const handleRequestShipping = async (claim: ClaimedCardView) => {
    setActionError(null);
    setBusyClaimId(claim.claimId);
    try {
      await requestShipping(claim.claimId);
      setClaims((prev) =>
        prev.map((c) => (c.claimId === claim.claimId ? { ...c, shipRequestedAt: Date.now() } : c)),
      );
    } catch (err) {
      setActionError(extractErrorMessage(err) ?? "Failed to request shipping");
    } finally {
      setBusyClaimId(null);
    }
  };

  const handleRespondToOffer = async (offer: CardOffer, accept: boolean) => {
    setOfferErrorById((prev) => ({ ...prev, [offer.id]: "" }));
    setOfferBusyId(offer.id);
    try {
      const supabase = createClient();
      const { error } = await supabase.rpc("respond_to_offer", { p_offer_id: offer.id, p_accept: accept });
      if (error) throw error;
    } catch (err) {
      setOfferErrorById((prev) => ({
        ...prev,
        [offer.id]: extractErrorMessage(err) ?? "Failed to respond to offer",
      }));
    } finally {
      setOfferBusyId(null);
    }
  };

  const handleAddOfferToCart = (offer: CardOffer, card: CardItem) => {
    addToCart(card.id, 1, offerFulfillment[offer.id] ?? "SHIP", offerPayment[offer.id] ?? "PREPAID", {
      offerId: offer.id,
      agreedAmount: offer.agreedAmount ?? offer.offeredAmount,
    });
    setAddedOfferId(offer.id);
    setTimeout(() => setAddedOfferId(null), 3000);
  };

  const isEmpty =
    !loading && !loadError && claims.length === 0 && queuedCards.length === 0 && offeredCards.length === 0;
  const shipClaims = claims.filter((c) => c.fulfillmentMethod === "SHIP");
  const stashClaims = claims.filter((c) => c.fulfillmentMethod === "STASH");

  const renderClaimTile = (claim: ClaimedCardView) => {
    const stage = claimStage(claim);
    const busy = busyClaimId === claim.claimId;
    const alreadyReviewed = reviewedClaimIds.has(claim.claimId);
    return (
      <div
        key={claim.claimId}
        className="flex flex-col overflow-hidden rounded-2xl border border-card-border bg-card transition-shadow hover:glow-gold"
      >
        <Link href={`/card/${claim.card.id}`}>
          <div className="relative aspect-[3/4] w-full bg-navy-950/5">
            {claim.card.images[0] ? (
              // eslint-disable-next-line @next/next/no-img-element -- arbitrary seller-supplied image URLs
              <img src={claim.card.images[0]} alt={claim.card.title} loading="lazy" decoding="async" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-foreground-muted">
                <ImageOff size={24} />
              </div>
            )}
          </div>
          <div className="flex flex-col gap-1 p-3">
            <p className="line-clamp-1 text-sm font-semibold text-foreground">{claim.card.title}</p>
            <p className="text-sm text-foreground-muted">
              {claim.card.setName} • {formatCurrency(claim.card.price)}
              {claim.quantity > 1 ? ` × ${claim.quantity}` : ""}
            </p>
            {claim.paymentMethod === "COD" && (
              <span className="inline-flex w-fit items-center gap-1 rounded-full bg-pending-bg px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-pending">
                <Banknote size={10} />
                Cash on Delivery
              </span>
            )}
          </div>
        </Link>
        <div className="px-3 pb-3">
          <ClaimStageTracker stage={stage} fulfillmentMethod={claim.fulfillmentMethod} />
        </div>
        <div className="flex flex-col gap-1.5 px-3 pb-3">
          {stage === "PENDING_PAYMENT" && claim.paymentMethod === "PREPAID" && qrByAdminId.get(claim.card.adminId ?? "") && (
            <a
              href={qrByAdminId.get(claim.card.adminId ?? "")}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 rounded-lg border border-gold/40 bg-navy-950/5 p-2"
              title="Tap to view full size"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- uploaded to Supabase Storage, not a local asset */}
              <img
                src={qrByAdminId.get(claim.card.adminId ?? "")}
                alt={`${claim.card.sellerHandle}'s payment QR code`}
                className="h-12 w-12 shrink-0 rounded-md border border-gold/40 object-cover"
              />
              <span className="flex items-center gap-1 text-xs text-foreground-muted">
                <QrCode size={12} className="shrink-0 text-gold" />
                Scan to pay {claim.card.sellerHandle}
              </span>
            </a>
          )}
          {stage === "PENDING_PAYMENT" && (
            <Button variant="danger" disabled={busy} onClick={() => handleCancel(claim)} className="w-full">
              {busy ? "Cancelling..." : "Cancel"}
            </Button>
          )}
          {stage === "PAID" && claim.fulfillmentMethod === "STASH" && (
            claim.shipRequestedAt ? (
              <p className="rounded-lg border border-card-border px-3 py-1.5 text-center text-xs font-medium text-foreground-muted">
                Shipping requested
              </p>
            ) : (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => handleRequestShipping(claim)}
                className="w-full"
              >
                {busy ? "Sending..." : "Request Shipping"}
              </Button>
            )
          )}
          {stage === "SHIPPED" && (
            <Button variant="gold" disabled={busy} onClick={() => handleMarkReceived(claim)} className="w-full">
              {busy ? "Saving..." : "Mark Received"}
            </Button>
          )}
          {stage === "RECEIVED" && !alreadyReviewed && (
            <Link
              href={`/account/reviews/new?claimId=${claim.claimId}`}
              className="block w-full rounded-lg border border-gold/40 px-3 py-1.5 text-center text-xs font-medium text-gold transition-colors hover:bg-gold/10"
            >
              Leave a Review
            </Link>
          )}
          {claim.status === "SOLD" && (
            <Link
              href={`/account/disputes/new?claimId=${claim.claimId}`}
              className="block w-full rounded-lg border border-card-border px-3 py-1.5 text-center text-xs font-medium text-foreground-muted transition-colors hover:border-sold/40 hover:text-sold"
            >
              Report an Issue
            </Link>
          )}
        </div>
      </div>
    );
  };

  const renderOfferTile = ({ card, offer }: OfferedCardView) => {
    const inactive = ["DECLINED", "BUYER_DECLINED", "EXPIRED", "SUPERSEDED", "FULFILLED"].includes(offer.status);
    const busy = offerBusyId === offer.id;
    const tileError = offerErrorById[offer.id];
    const fulfillment = offerFulfillment[offer.id] ?? "SHIP";
    const payment = offerPayment[offer.id] ?? "PREPAID";
    const codAvailable = Boolean(card.adminId && codEnabledByAdminId.get(card.adminId));
    const addedJustNow = addedOfferId === offer.id;
    const inCart = isInCart(card.id);

    return (
      <div
        key={offer.id}
        className={cn(
          "flex flex-col overflow-hidden rounded-2xl border border-card-border bg-card transition-shadow hover:glow-gold",
          inactive && "opacity-60",
        )}
      >
        <Link href={`/card/${card.id}`} className="relative block aspect-[3/4] w-full bg-navy-950/5">
          {card.images[0] ? (
            // eslint-disable-next-line @next/next/no-img-element -- arbitrary seller-supplied image URLs
            <img src={card.images[0]} alt={card.title} loading="lazy" decoding="async" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-foreground-muted">
              <ImageOff size={24} />
            </div>
          )}
          <div className="absolute right-2 top-2">
            {offer.status === "PENDING" && (
              <span className="rounded-full bg-pending-bg px-2 py-0.5 text-xs font-semibold text-pending">
                Offer pending
              </span>
            )}
            {offer.status === "COUNTERED" && (
              <span className="rounded-full bg-pending-bg px-2 py-0.5 text-xs font-semibold text-pending">
                Countered: {formatCurrency(offer.counterAmount ?? offer.offeredAmount)}
              </span>
            )}
            {offer.status === "ACCEPTED" && (
              <span className="rounded-full bg-available-bg px-2 py-0.5 text-xs font-semibold text-available">
                Accepted
              </span>
            )}
            {offer.status === "FULFILLED" && (
              <span className="rounded-full bg-available-bg px-2 py-0.5 text-xs font-semibold text-available">
                Purchased
              </span>
            )}
            {offer.status === "DECLINED" && (
              <span className="rounded-full bg-sold-bg px-2 py-0.5 text-xs font-semibold text-sold">Declined</span>
            )}
            {offer.status === "BUYER_DECLINED" && (
              <span className="rounded-full bg-sold-bg px-2 py-0.5 text-xs font-semibold text-sold">
                You declined
              </span>
            )}
            {offer.status === "EXPIRED" && (
              <span className="rounded-full bg-foreground/5 px-2 py-0.5 text-xs font-semibold text-foreground-muted">
                No response - expired
              </span>
            )}
            {offer.status === "SUPERSEDED" && (
              <span className="rounded-full bg-foreground/5 px-2 py-0.5 text-xs font-semibold text-foreground-muted">
                Superseded
              </span>
            )}
          </div>
        </Link>
        <div className="flex flex-col gap-2 p-3">
          <Link href={`/card/${card.id}`}>
            <p className="line-clamp-1 text-sm font-semibold text-foreground">{card.title}</p>
            <p className="text-sm text-foreground-muted">Your offer: {formatCurrency(offer.offeredAmount)}</p>
          </Link>

          {offer.status === "COUNTERED" && (
            <>
              {tileError && <p className="text-xs text-sold">{tileError}</p>}
              <div className="flex gap-1.5">
                <Button
                  variant="gold"
                  disabled={busy}
                  onClick={() => handleRespondToOffer(offer, true)}
                  className="flex-1 px-2 py-1.5 text-xs"
                >
                  Accept
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => handleRespondToOffer(offer, false)}
                  className="flex-1 px-2 py-1.5 text-xs"
                >
                  Decline
                </Button>
              </div>
            </>
          )}

          {offer.status === "ACCEPTED" &&
            (inCart ? (
              <Link
                href="/cart"
                className="block w-full rounded-lg border border-gold/40 px-3 py-1.5 text-center text-xs font-medium text-gold transition-colors hover:bg-gold/10"
              >
                In Cart - View Cart
              </Link>
            ) : (
              <>
                {addedJustNow && <p className="text-xs text-available">Added to cart.</p>}
                <div className="flex gap-1.5">
                  {(
                    [
                      { key: "SHIP" as const, label: "Ship", icon: Truck },
                      { key: "STASH" as const, label: "Stash", icon: PackageCheck },
                    ]
                  ).map(({ key, label, icon: Icon }) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => {
                        setOfferFulfillment((prev) => ({ ...prev, [offer.id]: key }));
                        // COD implies a courier - doesn't apply once stashing with the seller.
                        if (key === "STASH") setOfferPayment((prev) => ({ ...prev, [offer.id]: "PREPAID" }));
                      }}
                      className={cn(
                        "inline-flex flex-1 items-center justify-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium transition-colors",
                        fulfillment === key
                          ? "border-gold bg-gold text-navy-950"
                          : "border-card-border text-foreground-muted hover:border-gold/50 hover:text-foreground",
                      )}
                    >
                      <Icon size={11} />
                      {label}
                    </button>
                  ))}
                </div>
                {codAvailable && fulfillment === "SHIP" && (
                  <div className="flex gap-1.5">
                    {(
                      [
                        { key: "PREPAID" as const, label: "Pay Now", icon: Wallet },
                        { key: "COD" as const, label: "COD", icon: Banknote },
                      ]
                    ).map(({ key, label, icon: Icon }) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setOfferPayment((prev) => ({ ...prev, [offer.id]: key }))}
                        className={cn(
                          "inline-flex flex-1 items-center justify-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium transition-colors",
                          payment === key
                            ? "border-gold bg-gold text-navy-950"
                            : "border-card-border text-foreground-muted hover:border-gold/50 hover:text-foreground",
                        )}
                      >
                        <Icon size={11} />
                        {label}
                      </button>
                    ))}
                  </div>
                )}
                {tileError && <p className="text-xs text-sold">{tileError}</p>}
                <Button
                  variant="gold"
                  disabled={busy}
                  onClick={() => handleAddOfferToCart(offer, card)}
                  className="w-full px-2 py-1.5 text-xs"
                >
                  Add to Cart — {formatCurrency(offer.agreedAmount ?? offer.offeredAmount)}
                </Button>
                {/* Backs out of an offer already agreed to, before it's spent via checkout - respond_to_offer allows p_accept=false on an ACCEPTED offer too, not just a COUNTERED one. */}
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => handleRespondToOffer(offer, false)}
                  className="w-full px-2 py-1.5 text-xs"
                >
                  Decline
                </Button>
              </>
            ))}
        </div>
      </div>
    );
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <h1 className="mb-6 text-2xl font-bold text-foreground">My Dibs {buyer ? `— ${buyer.handle}` : ""}</h1>

      {loading && (
        <div className="flex flex-col items-center gap-2 py-10">
          <LogoSpinner size={28} />
          <p className="text-sm text-foreground-muted">Loading...</p>
        </div>
      )}

      {!loading && loadError && (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-card-border py-24 text-center">
          <p className="text-sm text-sold">{loadError}</p>
          <Button variant="outline" onClick={() => window.location.reload()}>
            Try Again
          </Button>
        </div>
      )}

      {isEmpty && (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-card-border py-24 text-center">
          <PackageSearch size={28} className="mb-3 text-foreground-muted" />
          <p className="text-sm text-foreground-muted">You haven&apos;t claimed dibs on any cards yet.</p>
        </div>
      )}

      {actionError && <p className="mb-4 text-sm text-sold">{actionError}</p>}

      {offeredCards.length > 0 && (
        <div className="mb-8">
          <h2 className="mb-4 text-lg font-semibold text-foreground">My Offers</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {offeredCards.map(renderOfferTile)}
          </div>
        </div>
      )}

      {shipClaims.length > 0 && (
        <div className="mb-8">
          <h2 className="mb-4 flex items-center gap-1.5 text-lg font-semibold text-foreground">
            <Truck size={18} />
            To Ship
          </h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {shipClaims.map(renderClaimTile)}
          </div>
        </div>
      )}

      {stashClaims.length > 0 && (
        <div className="mb-8">
          <h2 className="mb-4 flex items-center gap-1.5 text-lg font-semibold text-foreground">
            <PackageCheck size={18} />
            My Stash
          </h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {stashClaims.map(renderClaimTile)}
          </div>
        </div>
      )}

      {queuedCards.length > 0 && (
        <div className="mb-8">
          <h2 className="mb-4 flex items-center gap-1.5 text-lg font-semibold text-foreground">
            <Hourglass size={18} />
            Waiting in Queue
          </h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {queuedCards.map(({ card, position, requestedQuantity, lockedPrice }) => (
              <Link
                key={card.id}
                href={`/card/${card.id}`}
                className="flex flex-col overflow-hidden rounded-2xl border border-card-border bg-card transition-shadow hover:glow-gold"
              >
                <div className="relative aspect-[3/4] w-full bg-navy-950/5">
                  {card.images[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element -- arbitrary seller-supplied image URLs
                    <img src={card.images[0]} alt={card.title} loading="lazy" decoding="async" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-foreground-muted">
                      <ImageOff size={24} />
                    </div>
                  )}
                  <div className="absolute right-2 top-2">
                    <span className="flex items-center gap-1 rounded-full bg-pending-bg px-2 py-0.5 text-xs font-semibold text-pending">
                      <Hourglass size={12} />
                      #{position} in queue
                    </span>
                  </div>
                </div>
                <div className="flex flex-col gap-1 p-3">
                  <p className="line-clamp-1 text-sm font-semibold text-foreground">{card.title}</p>
                  <p className="text-sm text-foreground-muted">
                    {card.setName} • {formatCurrency(lockedPrice ?? card.price)}
                  </p>
                  <p className="text-xs text-foreground-muted">
                    Waiting for {requestedQuantity} unit{requestedQuantity === 1 ? "" : "s"}
                    {lockedPrice != null && " at your locked-in price"}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
