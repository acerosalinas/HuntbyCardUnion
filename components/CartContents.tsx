"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ClipboardCheck, ImageOff, PackageCheck, ShoppingCart, Trash2, Truck } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { useCart } from "@/components/CartProvider";
import { useBuyerIdentity } from "@/components/BuyerIdentityProvider";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { buildMessengerUrl, extractErrorMessage, formatCurrency } from "@/lib/utils";
import { CardItem, CardRow, cardFromRow, FulfillmentMethod, PlaceOrderResult } from "@/types/marketplace";

export function CartContents() {
  const { items, setQuantity, removeFromCart, clearCart } = useCart();
  const { buyer, loading: identityLoading } = useBuyerIdentity();
  const router = useRouter();
  const [cards, setCards] = useState<CardItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultSummary, setResultSummary] = useState<string[] | null>(null);
  const [messengerLinks, setMessengerLinks] = useState<{ sellerMessenger: string; url: string }[]>([]);
  const [shipName, setShipName] = useState("");
  const [shipPhone, setShipPhone] = useState("");
  const [shipAddress, setShipAddress] = useState("");
  const [shipZip, setShipZip] = useState("");
  const shipPrefilled = useRef(false);

  // Pre-fill from the buyer's saved shipping default (set at /account/edit)
  // so repeat orders don't require retyping name/phone/address/zip every
  // time - still fully editable per order below, this is just a starting
  // point. Only runs once per mount, guarded by the ref, so it can't
  // clobber an in-progress edit if the buyer identity object happens to be
  // replaced by BuyerIdentityProvider's own reconciliation later.
  useEffect(() => {
    if (!buyer || shipPrefilled.current) return;
    shipPrefilled.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time prefill of the checkout form from the buyer's saved default once their identity resolves
    if (buyer.shipName) setShipName(buyer.shipName);
    if (buyer.shipPhone) setShipPhone(buyer.shipPhone);
    if (buyer.shipAddress) setShipAddress(buyer.shipAddress);
    if (buyer.shipZip) setShipZip(buyer.shipZip);
  }, [buyer]);

  const cardIds = items.map((i) => i.cardId);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cardIds is derived from items every render; re-fetching on its stringified identity avoids looping on a fresh array reference
  }, [cardIds.join(",")]);

  const getQty = (cardId: string) => items.find((i) => i.cardId === cardId)?.quantity ?? 1;
  const getFulfillment = (cardId: string): FulfillmentMethod =>
    items.find((i) => i.cardId === cardId)?.fulfillmentMethod ?? "SHIP";
  const shipCards = cards.filter((c) => getFulfillment(c.id) === "SHIP");
  const stashCards = cards.filter((c) => getFulfillment(c.id) === "STASH");
  const total = cards.reduce((sum, c) => sum + c.price * getQty(c.id), 0);
  const totalUnits = cards.reduce((sum, c) => sum + getQty(c.id), 0);

  const handlePlaceOrder = async () => {
    // The buyer's session/profile is fetched async on mount - if this fires
    // before that resolves, `buyer` is still null even for someone who's
    // really logged in, which would wrongly bounce them to login.
    if (identityLoading) return;
    if (!buyer) {
      router.push("/account/login?from=%2Fcart");
      return;
    }

    if (!shipName.trim() || !shipPhone.trim()) {
      setError("Enter your name and phone number before checking out.");
      return;
    }
    if (shipCards.length > 0 && (!shipAddress.trim() || !shipZip.trim())) {
      setError("Enter your shipping address and zip code for the items you're shipping.");
      return;
    }

    setError(null);
    setResultSummary(null);
    setMessengerLinks([]);
    setPlacing(true);
    try {
      const supabase = createClient();
      const { data, error: rpcError } = await supabase.rpc("place_order", {
        p_items: items.map((i) => ({ card_id: i.cardId, quantity: i.quantity, fulfillment_method: i.fulfillmentMethod })),
        p_ship_name: shipName.trim(),
        p_ship_phone: shipPhone.trim(),
        p_ship_address: shipCards.length > 0 ? shipAddress.trim() : "",
        p_ship_zip: shipCards.length > 0 ? shipZip.trim() : "",
      });
      if (rpcError) throw rpcError;

      const result = data as PlaceOrderResult;
      const claimedItems = result.items.filter((i) => i.result === "claimed");
      const queuedItems = result.items.filter((i) => i.result === "queued");
      const missingItems = result.items.filter((i) => i.result === "not_found");

      let copiedToClipboard = false;
      if (claimedItems.length > 0) {
        const bySeller = new Map<
          string,
          { title: string; price: number; quantity: number; fulfillmentMethod: FulfillmentMethod }[]
        >();
        for (const item of claimedItems) {
          const card = cards.find((c) => c.id === item.cardId);
          if (!card) continue;
          const list = bySeller.get(card.sellerMessenger) ?? [];
          list.push({
            title: item.title ?? card.title,
            price: item.price ?? card.price,
            quantity: item.quantity ?? 1,
            fulfillmentMethod: getFulfillment(item.cardId),
          });
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
        const shipLine = `Ship to: ${shipName.trim()} · ${shipPhone.trim()} · ${shipAddress.trim()}, ${shipZip.trim()}`;
        const stashLine = `Stashing with seller (no shipping) · Contact: ${shipName.trim()} · ${shipPhone.trim()}`;

        const links: { sellerMessenger: string; url: string }[] = [];
        for (const [sellerMessenger, sellerItems] of bySeller) {
          const toShip = sellerItems.filter((i) => i.fulfillmentMethod === "SHIP");
          const toStash = sellerItems.filter((i) => i.fulfillmentMethod === "STASH");
          const itemLines = (list: typeof sellerItems) =>
            list.map((i) => `• ${i.title} x${i.quantity} — ${formatCurrency(i.price * i.quantity)}`).join("\n");

          const sections: string[] = [];
          if (toShip.length > 0) {
            sections.push(`To Ship:`, itemLines(toShip), shipLine);
          }
          if (toStash.length > 0) {
            sections.push(`To Stash:`, itemLines(toStash), stashLine);
          }

          const subtotal = sellerItems.reduce((sum, i) => sum + i.price * i.quantity, 0);
          const message = [
            `Hi! I'd like to place an order${orderRef ? ` (${orderRef})` : ""}:`,
            "",
            ...sections,
            "",
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
          const url = buildMessengerUrl(sellerMessenger, message);
          links.push({ sellerMessenger, url });
          window.open(url, "_blank", "noopener,noreferrer");
        }
        setMessengerLinks(links);
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
          `${queuedItems.length} item${queuedItems.length === 1 ? "" : "s"} didn't have enough stock left — you've been added to the queue.`,
        );
      }
      if (missingItems.length > 0) {
        summary.push(`${missingItems.length} item${missingItems.length === 1 ? "" : "s"} no longer available and removed.`);
      }
      setResultSummary(summary);
      clearCart();
    } catch (err) {
      setError(extractErrorMessage(err) ?? "Failed to place order");
    } finally {
      setPlacing(false);
    }
  };

  const renderCardTile = (card: CardItem) => (
    <div key={card.id} className="flex flex-col overflow-hidden rounded-2xl border border-card-border bg-card">
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
        {card.quantityAvailable > 1 && (
          <div className="flex items-center gap-1.5">
            <label className="text-[10px] font-medium uppercase tracking-wide text-foreground-muted">Qty</label>
            <Input
              type="number"
              min={1}
              max={card.quantityAvailable}
              value={getQty(card.id)}
              onChange={(e) =>
                setQuantity(card.id, Math.max(1, Math.min(card.quantityAvailable, Number(e.target.value) || 1)))
              }
              className="h-8 w-16 px-2 py-1 text-sm"
            />
          </div>
        )}
        <Button variant="outline" className="mt-auto w-full" onClick={() => removeFromCart(card.id)}>
          <Trash2 size={14} />
          Remove
        </Button>
      </div>
    </div>
  );

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
          {messengerLinks.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-1">
              {messengerLinks.map((link) => (
                <a
                  key={link.sellerMessenger}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gold/40 px-3 py-1.5 text-xs font-medium text-gold transition-colors hover:bg-gold/10"
                >
                  Message {link.sellerMessenger} on Messenger
                </a>
              ))}
            </div>
          )}
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
          {shipCards.length > 0 && (
            <div className="mb-6">
              <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-foreground">
                <Truck size={16} />
                Ship Out ({shipCards.reduce((sum, c) => sum + getQty(c.id), 0)})
              </h2>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {shipCards.map(renderCardTile)}
              </div>
            </div>
          )}

          {stashCards.length > 0 && (
            <div className="mb-6">
              <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-foreground">
                <PackageCheck size={16} />
                Stash With Us ({stashCards.reduce((sum, c) => sum + getQty(c.id), 0)})
              </h2>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {stashCards.map(renderCardTile)}
              </div>
            </div>
          )}

          <div className="mt-2 space-y-3 rounded-2xl border border-card-border bg-card p-5">
            <h2 className="text-sm font-semibold text-foreground">Shipping Details</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input placeholder="Full Name" value={shipName} onChange={(e) => setShipName(e.target.value)} required />
              <Input
                type="tel"
                placeholder="Phone Number"
                value={shipPhone}
                onChange={(e) => setShipPhone(e.target.value)}
                required
              />
            </div>
            {shipCards.length > 0 && (
              <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
                <Textarea
                  rows={2}
                  placeholder="Shipping Address"
                  value={shipAddress}
                  onChange={(e) => setShipAddress(e.target.value)}
                  required
                />
                <Input placeholder="Zip Code" value={shipZip} onChange={(e) => setShipZip(e.target.value)} required />
              </div>
            )}
            {shipCards.length === 0 && (
              <p className="text-xs text-foreground-muted">
                Everything in your cart is being stashed with the seller - no address needed.
              </p>
            )}
          </div>

          <div className="mt-4 flex flex-col items-stretch gap-3 rounded-2xl border border-card-border bg-card p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <span className="text-sm text-foreground-muted">
                Total ({totalUnits} unit{totalUnits === 1 ? "" : "s"})
              </span>
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
