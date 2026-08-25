"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/Button";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-24 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full border border-sold/40 bg-navy-950 text-sold">
        <AlertTriangle size={26} />
      </div>
      <h1 className="text-xl font-semibold text-foreground">Something went wrong</h1>
      <p className="text-sm text-foreground-muted">
        That&apos;s on us, not you - try again, or head back and pick up where you left off.
      </p>
      {error.digest && <p className="font-mono text-xs text-foreground-muted">Ref: {error.digest}</p>}
      <div className="flex w-full gap-2">
        <Button variant="outline" className="flex-1" onClick={reset}>
          Try Again
        </Button>
        <Link href="/" className="flex-1">
          <Button variant="gold" className="w-full">
            Go Home
          </Button>
        </Link>
      </div>
    </div>
  );
}
