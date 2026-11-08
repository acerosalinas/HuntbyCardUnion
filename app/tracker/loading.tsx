/**
 * Shown the instant a tracker tab is clicked, while the next page's data loads. Without a loading file, Next waits for the whole page
 * before it changes anything, so the click looks ignored; with one, the tab switches at once and this skeleton fills the gap.
 */
export default function TrackerLoading() {
  return (
    <div role="status" aria-label="Loading" className="animate-pulse space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 rounded-2xl border border-card-border bg-card" />
        ))}
      </div>
      <div className="flex gap-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-9 w-28 rounded-full border border-card-border bg-card" />
        ))}
      </div>
      <div className="space-y-3">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-16 rounded-2xl border border-card-border bg-card" />
        ))}
      </div>
    </div>
  );
}
