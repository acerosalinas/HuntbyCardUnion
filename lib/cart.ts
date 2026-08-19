const CART_STORAGE_KEY = "dibs_cart";
const CART_OWNER_STORAGE_KEY = "dibs_cart_owner";

export function getStoredCartIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CART_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function setStoredCartIds(ids: string[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(ids));
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
