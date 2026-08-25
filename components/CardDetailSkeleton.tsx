/** Placeholder matching CardDetail's layout - shown instantly (via app/card/[id]/loading.tsx) while the card query resolves. */
export function CardDetailSkeleton() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <div className="mb-5 h-4 w-32 animate-pulse rounded bg-foreground/10" />
      <div className="grid gap-8 md:grid-cols-2">
        <div className="aspect-[3/4] w-full animate-pulse rounded-2xl border border-card-border bg-foreground/5" />
        <div className="flex flex-col gap-4">
          <div className="flex gap-2">
            <div className="h-6 w-16 animate-pulse rounded-full bg-foreground/10" />
            <div className="h-6 w-20 animate-pulse rounded-full bg-foreground/10" />
          </div>
          <div className="space-y-2">
            <div className="h-7 w-3/4 animate-pulse rounded bg-foreground/10" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-foreground/5" />
          </div>
          <div className="h-16 w-full animate-pulse rounded-xl border-y border-card-border bg-foreground/5" />
          <div className="grid grid-cols-2 gap-3">
            <div className="h-10 animate-pulse rounded-lg bg-foreground/10" />
            <div className="h-10 animate-pulse rounded-lg bg-foreground/10" />
          </div>
        </div>
      </div>
    </div>
  );
}
