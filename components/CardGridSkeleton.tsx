/** Placeholder grid matching CardGrid's layout - shown instantly (via loading.tsx) while a marketplace/franchise/seller page's card query resolves. */
export function CardGridSkeleton({ count = 12 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:gap-5 md:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex flex-col overflow-hidden rounded-2xl border border-card-border bg-card">
          <div className="aspect-[3/4] w-full animate-pulse bg-foreground/5" />
          <div className="flex flex-col gap-2 p-3.5">
            <div className="h-4 w-3/4 animate-pulse rounded bg-foreground/10" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-foreground/5" />
            <div className="h-5 w-1/3 animate-pulse rounded bg-foreground/10" />
          </div>
        </div>
      ))}
    </div>
  );
}
