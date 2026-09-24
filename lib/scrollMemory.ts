/**
 * Remembers "how much of this list was loaded" and "how far down the page
 * was I" across a browser back/forward - e.g. opening a card from the
 * marketplace, then pressing Back, should land you back where you were
 * instead of at the top with only the first batch loaded.
 *
 * Deliberately a plain module-level Map, not sessionStorage/localStorage:
 * this only needs to survive a component unmount/remount within the same
 * in-app session (the marketplace page unmounts when you navigate to a card
 * and remounts on the way back), and a hard refresh SHOULD start fresh at
 * the top rather than silently resuming a scroll position from a previous
 * visit, which persisted storage would do.
 *
 * Keyed by whatever the caller considers "this scroll position belongs to
 * this exact view" - typically the same string already used to reset
 * usePaginatedList (filter criteria, franchise/seller scope), so a changed
 * filter naturally has no stale memory to restore.
 */
const memory = new Map<string, { visibleCount: number; scrollY: number }>();

export function getScrollMemory(key: string) {
  return memory.get(key);
}

export function saveScrollMemory(key: string, value: { visibleCount: number; scrollY: number }) {
  memory.set(key, value);
}
