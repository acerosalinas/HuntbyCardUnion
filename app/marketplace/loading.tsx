import { CardGridSkeleton } from "@/components/CardGridSkeleton";

export default function Loading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <div className="mb-4 h-6 w-32 animate-pulse rounded bg-foreground/10" />
      <CardGridSkeleton />
    </div>
  );
}
