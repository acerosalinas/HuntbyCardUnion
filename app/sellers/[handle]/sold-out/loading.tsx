import { CardGridSkeleton } from "@/components/CardGridSkeleton";

export default function Loading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="h-5 w-32 animate-pulse rounded bg-foreground/10" />
        <div className="h-5 w-20 animate-pulse rounded bg-foreground/10" />
      </div>
      <CardGridSkeleton />
    </div>
  );
}
