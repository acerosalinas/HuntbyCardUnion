"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ClipboardCheck, ImageOff, ShoppingCart, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useCart } from "@/components/CartProvider";
import { useBuyerIdentity } from "@/components/BuyerIdentityProvider";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { buildMessengerUrl, formatCurrency } from "@/lib/utils";
import { CardItem, CardRow, cardFromRow, PlaceOrderResult } from "@/types/marketplace";

export function CartContents() {
  const { cardIds, removeFromCart, clearCart } = useCart();
  const { buyer, loading: identityLoading } = useBuyerIdentity();
  const router = useRouter();
  const [cards, setCards] = useState<CardItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultSummary, setResultSummary] = useState<string[] | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    if (cardIds.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing displayed cart items with an empty cart
      setCards([]);
      return;
    }
    setLoading(true);
    const supabase = createClient();
    supabase
      .from("cards")
      .select("*")
      .in("id", cardIds)
      .then(({ data }) => {
        setCards(((data as CardRow[] | null) ?? []).map(cardFromRow));
        setLoading(false);
      });
  }, [cardIds]);

  const total = cards.reduce((sum, c) => sum + c.price, 0);

  const handlePlaceOrder = async () => {
    // The buyer's session/profile is fetched async on mount - if this fires
    // before that resolves, `buyer` is still null even for someone who's
    // really logged in, which would wrongly bounce them to login.
    if (identityLoading) return;
    if (!buyer) {
      router.push("/account/login?from=%2Fcart");
      return;
    }

    setError(null);
    setResultSummary(null);
    setPlacing(true);
    try {
      const supabase = createClient();
      const { data, error: rpcError } = await supabase.rpc("place_order", {
        p_card_ids: cardIds,
      });
      if (rpcError) throw rpcError;

      const result = data as PlaceOrderResult;
      const claimedItems = result.items.filter((i) => i.result === "claimed");
      const queuedItems = result.items.filter((i) => i.result === "queued");
      const soldItems = result.items.filter((i) => i.result === "sold" || i.result === "not_found");

      let copiedToClipboard = false;
      if (claimedItems.length > 0) {
        const bySeller = new Map<string, { title: string; price: number }[]>();
        for (const item of claimedItems) {
          const card = cards.find((c) => c.id === item.cardId);
          if (!card) continue;
          const list = bySeller.get(card.sellerMessenger) ?? [];
          list.push({ title: item.title ?? card.title, price: item.price ?? card.price });
          bySeller.set(card.sellerMessenger, list);
        }

        // Messenger's m.me `text=` prefill is unreliable in practice (it's
        // an unofficial parameter - only guaranteed to work for configured
        // Business Pages, and even then some clients seem to cut it off at
        // the first newline). The clipboard copy is the part that's always
        // 100% correct and complete, regardless of what the prefill does -
        // the UI below tells the buyer to paste it, rather than assuming
        // the opened chat already has the full message.
        const orderRef = result.orderId ? `Order #${result.orderId.slice(0, 8)}` : null;
        const buyerLine = `Buyer: ${buyer.fullName} (${buyer.handle})`;

        for (const [sellerMessenger, items] of bySeller) {
          const lines = items.map((i) => `• ${i.title} — ${formatCurrency(i.price)}`).join("\n");
          const subtotal = items.reduce((sum, i) => sum + i.price, 0);
          const message = [
            `Hi! I'd like to place an order${orderRef ? ` (${orderRef})` : ""}:`,
            lines,
            `Total: ${formatCurrency(subtotal)}`,
            "",
            buyerLine,
          ].join("\n");
          try {
            await navigator.clipboard.writeText(message);
            copiedToClipboard = true;
          } catch {
            // Non-fatal - the Messenger tab still opens below.
          }
          window.open(buildMessengerUrl(sellerMessenger, message), "_blank", "noopener,noreferrer");
        }
      }

      const summary: string[] = [];
      if (claimedItems.length > 0) {
        summary.push(
          `${claimedItems.length} item${claimedItems.length === 1 ? "" : "s"} secured.${
            copiedToClipboard
              ? " Your full order message (with your name and every item) was copied to your clipboard - if Messenger doesn't show it all, just paste (Ctrl+V / Cmd+V) it into the chat."
              : " Opened Messenger for you - let the seller know which cards you're buying."
          }`,
        );
      }
      if (queuedItems.length > 0) {
        summary.push(
          `${queuedItems.length} item${queuedItems.length === 1 ? "" : "s"} already claimed by someone else — you've been added to the queue.`,
        );
      }
      if (soldItems.length > 0) {
        summary.push(`${soldItems.length} item${soldItems.length === 1 ? "" : "s"} no longer available and removed.`);
      }
      setResultSummary(summary);
      clearCart();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to place order");
    } finally {
      setPlacing(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <h1 className="mb-6 text-2xl font-bold text-foreground">Your Cart</h1>

      {resultSummary && (
        <div className="mb-6 space-y-1.5 rounded-2xl border border-gold/40 bg-navy-950 p-4 text-sm text-ivory">
          {resultSummary.map((line) => (
            <p key={line} className="flex items-start gap-1.5">
              <ClipboardCheck size={14} className="mt-0.5 shrink-0 text-gold" />
              {line}
            </p>
          ))}
        </div>
      )}

      {loading && <p className="text-sm text-foreground-muted">Loading...</p>}

      {!loading && cards.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-card-border py-24 text-center">
          <ShoppingCart size={28} className="mb-3 text-foreground-muted" />
          <p className="mb-4 text-sm text-foreground-muted">Your cart is empty.</p>
          <Link href="/">
            <Button variant="gold">Browse Collections</Button>
          </Link>
        </div>
      )}

      {cards.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {cards.map((card) => (
              <div
                key={card.id}
                className="flex flex-col overflow-hidden rounded-2xl border border-card-border bg-card"
              >
                <Link href={`/card/${card.id}`} className="relative block aspect-[3/4] w-full bg-navy-950/5">
                  {card.images[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element -- arbitrary seller-supplied image URLs
                    <img src={card.images[0]} alt={card.title} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-foreground-muted">
                      <ImageOff size={24} />
                    </div>
                  )}
                </Link>
                <div className="flex flex-1 flex-col gap-2 p-3">
                  <div>
                    <p className="line-clamp-1 text-sm font-semibold text-foreground">{card.title}</p>
                    <p className="line-clamp-1 text-xs text-foreground-muted">{card.setName}</p>
                  </div>
                  <p className="text-sm font-bold text-foreground">{formatCurrency(card.price)}</p>
                  <Button
                    variant="outline"
                    className="mt-auto w-full"
                    onClick={() => removeFromCart(card.id)}
                  >
                    <Trash2 size={14} />
                    Remove
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 flex flex-col items-stretch gap-3 rounded-2xl border border-card-border bg-card p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <span className="text-sm text-foreground-muted">Total ({cards.length} item{cards.length === 1 ? "" : "s"})</span>
              <p className="text-2xl font-bold text-foreground">{formatCurrency(total)}</p>
            </div>
            <div className="sm:text-right">
              {error && <p className="mb-2 text-sm text-sold">{error}</p>}
              <Button
                variant="gold"
                disabled={placing || identityLoading}
                onClick={handlePlaceOrder}
                className="w-full sm:w-auto"
              >
                {identityLoading ? "Loading..." : placing ? "Placing Order..." : "Place Order"}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
