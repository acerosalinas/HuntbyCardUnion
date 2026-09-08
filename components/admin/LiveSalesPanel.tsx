"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ImageOff, Radio, Trash2, UserCheck } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { cn, extractErrorMessage, formatCurrency, formatRelativeTime } from "@/lib/utils";
import { assignLiveSale, findBuyerByHandle, removeLiveSale } from "@/app/admin/actions";
import { FulfillmentMethod, PaymentMethod } from "@/types/marketplace";

export interface AssignableCard {
  id: string;
  title: string;
  image: string | null;
  price: number;
  quantityAvailable: number;
}

export interface LiveSaleClaimView {
  id: string;
  cardTitle: string;
  cardImage: string | null;
  buyerHandle: string;
  quantity: number;
  unitPrice: number;
  status: "PENDING" | "SOLD";
  claimedAt: number;
}

interface BuyerResult {
  id: string;
  handle: string;
  fullName: string;
}

/** Debounced buyer-handle search - waits for a pause in typing rather than firing a lookup on every keystroke. */
function useBuyerSearch(query: string) {
  const [results, setResults] = useState<BuyerResult[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing stale results now that the query is too short to search, not synchronizing render state
      setResults([]);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      findBuyerByHandle(q)
        .then(setResults)
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  return { results, searching };
}

export function LiveSalesPanel({ cards, liveSales }: { cards: AssignableCard[]; liveSales: LiveSaleClaimView[] }) {
  const [pending, startTransition] = useTransition();
  const [cardId, setCardId] = useState(cards[0]?.id ?? "");
  const [buyerQuery, setBuyerQuery] = useState("");
  const [selectedBuyer, setSelectedBuyer] = useState<BuyerResult | null>(null);
  const [fulfillmentMethod, setFulfillmentMethod] = useState<FulfillmentMethod>("SHIP");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("PREPAID");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busyClaimId, setBusyClaimId] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const { results, searching } = useBuyerSearch(selectedBuyer ? "" : buyerQuery);

  const selectedCard = cards.find((c) => c.id === cardId) ?? null;

  const handleAssign = () => {
    if (!selectedCard || !selectedBuyer) return;
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      try {
        await assignLiveSale({
          cardId: selectedCard.id,
          buyerId: selectedBuyer.id,
          fulfillmentMethod,
          paymentMethod,
        });
        setSuccess(`"${selectedCard.title}" assigned to ${selectedBuyer.handle} - they've been notified to pay.`);
        setSelectedBuyer(null);
        setBuyerQuery("");
      } catch (err) {
        setError(extractErrorMessage(err) ?? "Failed to assign");
      }
    });
  };

  const handleRemove = (claim: LiveSaleClaimView) => {
    if (!window.confirm(`Remove this sale of "${claim.cardTitle}" to ${claim.buyerHandle}? The card goes back in stock.`)) return;
    setError(null);
    setBusyClaimId(claim.id);
    startTransition(async () => {
      try {
        await removeLiveSale(claim.id);
      } catch (err) {
        setError(extractErrorMessage(err) ?? "Failed to remove");
      } finally {
        setBusyClaimId(null);
      }
    });
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-card-border bg-card p-4">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-foreground-muted">
          <Radio size={14} className="text-gold" />
          Assign a Live Sale
        </h2>

        {cards.length === 0 ? (
          <p className="text-sm text-foreground-muted">No cards with stock available to assign right now.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-foreground-muted">Card</label>
              <Select value={cardId} onChange={(e) => setCardId(e.target.value)}>
                {cards.map((card) => (
                  <option key={card.id} value={card.id}>
                    {card.title} - {formatCurrency(card.price)} ({card.quantityAvailable} left)
                  </option>
                ))}
              </Select>
            </div>

            <div className="relative">
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-foreground-muted">Buyer</label>
              {selectedBuyer ? (
                <div className="flex items-center justify-between rounded-lg border border-gold/40 bg-gold/5 px-3 py-2 text-sm">
                  <span className="flex items-center gap-1.5">
                    <UserCheck size={14} className="text-gold" />
                    {selectedBuyer.handle} <span className="text-foreground-muted">({selectedBuyer.fullName})</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setSelectedBuyer(null)}
                    className="text-xs text-foreground-muted underline underline-offset-2 hover:text-foreground"
                  >
                    Change
                  </button>
                </div>
              ) : (
                <>
                  <Input
                    value={buyerQuery}
                    onChange={(e) => setBuyerQuery(e.target.value)}
                    placeholder="Search buyer by handle..."
                  />
                  {buyerQuery.trim().length >= 2 && (
                    <div ref={dropdownRef} className="absolute z-10 mt-1 w-full rounded-lg border border-card-border bg-card shadow-lg">
                      {searching ? (
                        <p className="px-3 py-2 text-sm text-foreground-muted">Searching...</p>
                      ) : results.length === 0 ? (
                        <p className="px-3 py-2 text-sm text-foreground-muted">No buyers found.</p>
                      ) : (
                        results.map((buyer) => (
                          <button
                            key={buyer.id}
                            type="button"
                            onClick={() => {
                              setSelectedBuyer(buyer);
                              setBuyerQuery("");
                            }}
                            className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-foreground/5"
                          >
                            <span className="font-medium">{buyer.handle}</span>
                            <span className="text-foreground-muted">{buyer.fullName}</span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </>
              )}
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-foreground-muted">Fulfillment</label>
              <div className="flex gap-2">
                {(["SHIP", "STASH"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setFulfillmentMethod(option)}
                    className={cn(
                      "flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                      fulfillmentMethod === option
                        ? "border-gold bg-gold text-navy-950"
                        : "border-card-border text-foreground-muted hover:border-gold/50 hover:text-foreground",
                    )}
                  >
                    {option === "SHIP" ? "Ship" : "Stash"}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-foreground-muted">Payment</label>
              <div className="flex gap-2">
                {(["PREPAID", "COD"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setPaymentMethod(option)}
                    className={cn(
                      "flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                      paymentMethod === option
                        ? "border-gold bg-gold text-navy-950"
                        : "border-card-border text-foreground-muted hover:border-gold/50 hover:text-foreground",
                    )}
                  >
                    {option === "PREPAID" ? "Prepaid" : "Cash on Delivery"}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {error && <p className="mt-3 text-sm text-sold">{error}</p>}
        {success && <p className="mt-3 text-sm text-available">{success}</p>}

        {cards.length > 0 && (
          <Button variant="gold" disabled={pending || !selectedBuyer} onClick={handleAssign} className="mt-4">
            {pending ? "Assigning..." : "Assign to Buyer"}
          </Button>
        )}
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-foreground-muted">
          Live Sales History ({liveSales.length})
        </h2>
        {liveSales.length === 0 ? (
          <p className="py-10 text-center text-sm text-foreground-muted">No live sales assigned yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-card-border">
            <table className="w-full min-w-160 text-left text-sm">
              <thead className="bg-card text-xs uppercase tracking-wide text-foreground-muted">
                <tr>
                  <th className="px-4 py-3">Card</th>
                  <th className="px-4 py-3">Buyer</th>
                  <th className="px-4 py-3">Price</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Assigned</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {liveSales.map((claim) => (
                  <tr key={claim.id} className="border-t border-card-border">
                    <td className="px-4 py-3 font-medium">
                      <div className="flex items-center gap-2">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-navy-950/5">
                          {claim.cardImage ? (
                            // eslint-disable-next-line @next/next/no-img-element -- arbitrary seller-supplied image URLs
                            <img src={claim.cardImage} alt={claim.cardTitle} className="h-full w-full object-cover" />
                          ) : (
                            <ImageOff size={14} className="text-foreground-muted" />
                          )}
                        </div>
                        {claim.cardTitle}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-foreground-muted">{claim.buyerHandle}</td>
                    <td className="px-4 py-3">{formatCurrency(claim.unitPrice * claim.quantity)}</td>
                    <td className="px-4 py-3">
                      <Badge tone={claim.status === "SOLD" ? "available" : "pending"}>
                        {claim.status === "SOLD" ? "Paid" : "Awaiting Payment"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-foreground-muted">{formatRelativeTime(claim.claimedAt)}</td>
                    <td className="px-4 py-3 text-right">
                      {claim.status === "SOLD" && (
                        <Button
                          variant="danger"
                          disabled={pending && busyClaimId === claim.id}
                          onClick={() => handleRemove(claim)}
                          className="gap-1.5 px-2 py-1.5 text-xs"
                        >
                          <Trash2 size={13} />
                          Remove
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
