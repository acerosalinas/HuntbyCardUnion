"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Banknote, Hourglass, ImageOff, PackageCheck, PackageSearch, QrCode, Truck } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { LogoSpinner } from "@/components/LogoSpinner";
import { ClaimStageTracker, ClaimStage } from "@/components/ClaimStageTracker";
import { useBuyerIdentity } from "@/components/BuyerIdentityProvider";
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
}

interface OfferedCardView {
  card: CardItem;
  offer: CardOffer;
}

const COUNTERED_PREFIX = "Countered by admin";

interface ClaimJoinRow {
  id: string;
  quantity: number;
  status: ClaimStatus;
  shipped: boolean;
  received_at: string | null;
  fulfillment_method: FulfillmentMethod;
  payment_method: PaymentMethod;
  cards: CardRow | null;
}

export function MyDibsContents() {
  const { buyer } = useBuyerIdentity();
  const [claims, setClaims] = useState<ClaimedCardView[]>([]);
  // Seller QR codes for still-unpaid claims - keyed by admin_id so the QR
  // stays reachable here for as long as payment is pending, instead of only
  // ever showing once on the cart's order-confirmation screen (which is
  // easy to navigate away from and lose).
  const [qrByAdminId, setQrByAdminId] = useState<Map<string, string>>(new Map());
  const [queuedCards, setQueuedCards] = useState<QueuedCardView[]>([]);
  const [offeredCards, setOfferedCards] = useState<OfferedCardView[]>([]);
  const [reviewedClaimIds, setReviewedClaimIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [busyClaimId, setBusyClaimId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!buyer || !isSupabaseConfigured()) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- toggling a loading flag before an async fetch
    setLoading(true);
    const supabase = createClient();

    Promise.all([
      supabase
        .from("card_claims")
        .select("id, quantity, status, shipped, received_at, fulfillment_method, payment_method, cards(*)")
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
      } else {
        setOfferedCards([]);
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
        result.push({ card, position: idx + 1, requestedQuantity: row.requested_quantity });
      }
      setQueuedCards(result);
      setLoading(false);
    });
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

  const isEmpty =
    !loading && claims.length === 0 && queuedCards.length === 0 && offeredCards.length === 0;
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

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <h1 className="mb-6 text-2xl font-bold text-foreground">My Dibs {buyer ? `— ${buyer.handle}` : ""}</h1>

      {loading && (
        <div className="flex flex-col items-center gap-2 py-10">
          <LogoSpinner size={28} />
          <p className="text-sm text-foreground-muted">Loading...</p>
        </div>
      )}

      {isEmpty && (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-card-border py-24 text-center">
          <PackageSearch size={28} className="mb-3 text-foreground-muted" />
          <p className="text-sm text-foreground-muted">You haven&apos;t claimed dibs on any cards yet.</p>
        </div>
      )}

      {actionError && <p className="mb-4 text-sm text-sold">{actionError}</p>}

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
            {queuedCards.map(({ card, position, requestedQuantity }) => (
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
                    {card.setName} • {formatCurrency(card.price)}
                  </p>
                  <p className="text-xs text-foreground-muted">
                    Waiting for {requestedQuantity} unit{requestedQuantity === 1 ? "" : "s"}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {offeredCards.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-4 text-lg font-semibold text-foreground">My Offers</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {offeredCards.map(({ card, offer }) => {
              const countered = offer.status === "PENDING" && offer.note?.startsWith(COUNTERED_PREFIX);
              const superseded = offer.status === "SUPERSEDED";
              return (
                <Link
                  key={offer.id}
                  href={`/card/${card.id}`}
                  className={cn(
                    "flex flex-col overflow-hidden rounded-2xl border border-card-border bg-card transition-shadow hover:glow-gold",
                    superseded && "opacity-60",
                  )}
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
                      {offer.status === "ACCEPTED" && (
                        <span className="rounded-full bg-available-bg px-2 py-0.5 text-xs font-semibold text-available">
                          Accepted
                        </span>
                      )}
                      {offer.status === "DECLINED" && (
                        <span className="rounded-full bg-sold-bg px-2 py-0.5 text-xs font-semibold text-sold">
                          Declined
                        </span>
                      )}
                      {superseded && (
                        <span className="rounded-full bg-foreground/5 px-2 py-0.5 text-xs font-semibold text-foreground-muted">
                          Superseded
                        </span>
                      )}
                      {offer.status === "PENDING" && (
                        <span className="rounded-full bg-pending-bg px-2 py-0.5 text-xs font-semibold text-pending">
                          {countered ? `Countered: ${formatCurrency(offer.offeredAmount)}` : "Offer pending"}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 p-3">
                    <p className="line-clamp-1 text-sm font-semibold text-foreground">{card.title}</p>
                    <p className="text-sm text-foreground-muted">
                      Your offer: {formatCurrency(offer.offeredAmount)}
                    </p>
                    {countered && offer.note && (
                      <p className="line-clamp-2 text-xs text-foreground-muted">{offer.note}</p>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
