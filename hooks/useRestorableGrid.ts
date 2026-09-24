import { useEffect, useLayoutEffect, useRef } from "react";
import { usePaginatedList } from "@/hooks/usePaginatedList";
import { getScrollMemory, saveScrollMemory } from "@/lib/scrollMemory";

/**
 * A batch-revealed card grid (see usePaginatedList) that also remembers how
 * far the buyer had scrolled and how much they'd loaded, and restores both
 * on remount - e.g. opening a card from a grid, then pressing Back, lands
 * you back where you were instead of at the top with only the first batch
 * loaded again. See lib/scrollMemory.ts for why this is an in-memory Map,
 * not persisted storage.
 *
 * `viewKey` should change only when the filter criteria producing `items`
 * changes, not on every re-render of `items` itself - see usePaginatedList's
 * comment for why (a realtime update elsewhere shouldn't reset your place).
 */
export function useRestorableGrid<T>(items: T[], viewKey: string) {
  const remembered = getScrollMemory(viewKey);
  const { visible, hasMore, remaining, loadMore, visibleCount } = usePaginatedList(
    items,
    viewKey,
    remembered?.visibleCount,
  );

  // Runs once per mount, using whatever `remembered` was at that first
  // render. useLayoutEffect so it happens before the browser paints the
  // top-of-page position first - cards reserve their layout height via CSS
  // aspect-ratio immediately, before their photos finish loading, so the
  // page is already the right height by the time this runs.
  const didRestoreScroll = useRef(false);
  useLayoutEffect(() => {
    if (didRestoreScroll.current) return;
    didRestoreScroll.current = true;
    if (remembered) window.scrollTo(0, remembered.scrollY);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Saves on every scroll (not just unmount) so the memory is accurate even
  // if the tab is closed rather than navigated away from normally.
  useEffect(() => {
    const save = () => saveScrollMemory(viewKey, { visibleCount, scrollY: window.scrollY });
    window.addEventListener("scroll", save, { passive: true });
    return () => {
      save();
      window.removeEventListener("scroll", save);
    };
  }, [viewKey, visibleCount]);

  return { visible, hasMore, remaining, loadMore };
}
