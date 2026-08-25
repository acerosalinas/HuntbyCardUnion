import Link from "next/link";
import { Compass } from "lucide-react";
import { Button } from "@/components/ui/Button";

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-24 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full border border-gold/40 bg-navy-950 text-gold glow-gold">
        <Compass size={26} />
      </div>
      <h1 className="text-xl font-semibold text-foreground">Page not found</h1>
      <p className="text-sm text-foreground-muted">
        That listing or page doesn&apos;t exist - it may have been sold, removed, or the link is off.
      </p>
      <Link href="/marketplace" className="w-full">
        <Button variant="gold" className="w-full">
          Browse the Marketplace
        </Button>
      </Link>
      <Link href="/" className="text-xs font-medium text-foreground-muted transition-colors hover:text-gold">
        Back to Home
      </Link>
    </div>
  );
}
