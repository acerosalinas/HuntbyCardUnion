export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <div className="mb-6 h-7 w-28 animate-pulse rounded bg-foreground/10" />
      <div className="flex flex-wrap gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-40 w-64 animate-pulse rounded-2xl border border-card-border bg-card" />
        ))}
      </div>
    </div>
  );
}
