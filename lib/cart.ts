const CART_STORAGE_KEY = "dibs_cart";
const CART_OWNER_STORAGE_KEY = "dibs_cart_owner";

export interface StoredCartItem {
  cardId: string;
  quantity: number;
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
      .map((item) => ({ cardId: item.cardId, quantity: Math.max(1, Math.round(item.quantity) || 1) }));
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
