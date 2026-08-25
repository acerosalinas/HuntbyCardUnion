import { CardGridSkeleton } from "@/components/CardGridSkeleton";

export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <div className="mb-6 flex flex-col items-center gap-3 rounded-2xl border border-card-border bg-card p-6 sm:flex-row sm:items-start">
        <div className="h-20 w-20 shrink-0 animate-pulse rounded-full bg-foreground/10" />
        <div className="flex flex-1 flex-col items-center gap-2 sm:items-start">
          <div className="h-6 w-40 animate-pulse rounded bg-foreground/10" />
          <div className="h-4 w-64 animate-pulse rounded bg-foreground/5" />
        </div>
      </div>
      <CardGridSkeleton />
    </div>
  );
}
