import { FulfillmentMethod, PaymentMethod } from "@/types/marketplace";

const CART_STORAGE_KEY = "dibs_cart";
const CART_OWNER_STORAGE_KEY = "dibs_cart_owner";

export interface StoredCartItem {
  cardId: string;
  quantity: number;
  /** Chosen at Add to Cart, locked in once ordered - see supabase/schema.sql's card_claims.fulfillment_method. */
  fulfillmentMethod: FulfillmentMethod;
  /** Chosen at Add to Cart, locked in once ordered - only ever COD if the seller has opted in (SellerProfile.codEnabled). */
  paymentMethod: PaymentMethod;
  /** Set when this item is being bought at a negotiated price through an accepted offer instead of the card's listed price - see offers.agreed_amount. Always paired with agreedAmount, and always quantity 1 (offers are single-unit). */
  offerId: string | null;
  agreedAmount: number | null;
}

export function getStoredCartItems(): StoredCartItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CART_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is StoredCartItem => item && typeof item.cardId === "string")
      .map((item) => ({
        cardId: item.cardId,
        // An offer-priced item is always exactly 1 unit, regardless of what a stale stored cart says.
        quantity: item.offerId ? 1 : Math.max(1, Math.round(item.quantity) || 1),
        // Defaults to SHIP/PREPAID for a cart saved before these fields existed.
        fulfillmentMethod: item.fulfillmentMethod === "STASH" ? "STASH" : "SHIP",
        paymentMethod: item.paymentMethod === "COD" ? "COD" : "PREPAID",
        offerId: typeof item.offerId === "string" ? item.offerId : null,
        agreedAmount: typeof item.agreedAmount === "number" ? item.agreedAmount : null,
      }));
  } catch {
    return [];
  }
}

export function setStoredCartItems(items: StoredCartItem[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
}

/** Buyer id the stored cart currently belongs to, or null if it was last saved while signed out. */
export function getStoredCartOwner(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(CART_OWNER_STORAGE_KEY);
}

export function setStoredCartOwner(buyerId: string | null): void {
  if (typeof window === "undefined") return;
  if (buyerId) {
    window.localStorage.setItem(CART_OWNER_STORAGE_KEY, buyerId);
  } else {
    window.localStorage.removeItem(CART_OWNER_STORAGE_KEY);
  }
}
