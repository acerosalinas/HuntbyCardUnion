import { LogoSpinner } from "@/components/LogoSpinner";

/** Generic branded fallback - used as the root loading.tsx catch-all for any route without its own tailored skeleton. */
export function PageSpinner() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-4 py-10 text-center">
      <LogoSpinner size={72} />
      <p className="text-sm text-foreground-muted">Loading...</p>
    </div>
  );
}
