import { Loader2 } from "lucide-react";

/** Generic branded fallback - used as the root loading.tsx catch-all for any route without its own tailored skeleton. */
export function PageSpinner() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 px-4 py-24 text-center">
      <Loader2 size={26} className="animate-spin text-gold" />
      <p className="text-sm text-foreground-muted">Loading...</p>
    </div>
  );
}
