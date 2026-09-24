import { useState } from "react";

const BATCH_SIZE = 24;

/**
 * Caps how many items of a filtered list actually render at once, growing by
 * BATCH_SIZE on "Load more" - without this, a grid of every matching card
 * rendered (and had its photo requested) all at once regardless of how many
 * there were, which is what made a large marketplace/storefront feel like it
 * never finished loading.
 *
 * `resetKey` should change only when the *filter criteria* changes (e.g. a
 * search query or category), not on every re-render of `items` - a realtime
 * price/stock update elsewhere produces a new `items` array reference too,
 * and resetting the count on that would yank away cards the buyer already
 * scrolled past loading more of. Resetting during render when `resetKey`
 * changes (the React-recommended "adjusting state based on a prop" pattern)
 * rather than in an effect, since this needs to happen before the resulting
 * slice is computed for this same render, not one render later.
 *
 * `initialCount`, if given, seeds the very first render for this `resetKey`
 * (e.g. restoring how much a buyer had loaded before they navigated away and
 * back - see lib/scrollMemory.ts) instead of always starting at BATCH_SIZE.
 */
export function usePaginatedList<T>(items: T[], resetKey: string, initialCount?: number) {
  const [state, setState] = useState({ resetKey, visibleCount: initialCount ?? BATCH_SIZE });

  if (state.resetKey !== resetKey) {
    setState({ resetKey, visibleCount: BATCH_SIZE });
  }
  const visibleCount = state.resetKey === resetKey ? state.visibleCount : BATCH_SIZE;

  return {
    visible: items.slice(0, visibleCount),
    hasMore: items.length > visibleCount,
    remaining: Math.max(0, items.length - visibleCount),
    visibleCount,
    loadMore: () => setState((s) => ({ ...s, visibleCount: s.visibleCount + BATCH_SIZE })),
  };
}
