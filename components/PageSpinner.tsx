import { LogoSpinner } from "@/components/LogoSpinner";

/**
 * Branded loading state, centered in the middle of the window (not the page flow, which sat it near the top). Pointer events pass
 * through, so the header above stays usable while it shows. Also the root loading.tsx catch-all for any route without its own skeleton.
 */
export function PageSpinner() {
  return (
    <div role="status" className="pointer-events-none fixed inset-0 z-30 flex flex-col items-center justify-center gap-3 px-4 text-center">
      <LogoSpinner size={72} />
      <p className="text-sm text-foreground-muted">Loading...</p>
    </div>
  );
}
