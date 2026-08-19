"use client";

import Link from "next/link";
import { useTransition } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { markPricesReviewed } from "@/app/admin/actions";

export function PriceReviewBanner({ hasProfile }: { hasProfile: boolean }) {
  const [pending, startTransition] = useTransition();

  if (!hasProfile) {
    return (
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-gold/40 bg-navy-950 px-4 py-3 text-sm text-ivory">
        <span className="flex items-center gap-2">
          <AlertTriangle size={16} className="text-gold" />
          Set up your Seller Profile so buyers can find you on the home page.
        </span>
        <Link href="/admin/profile">
          <Button variant="gold">Set Up Profile</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-gold/40 bg-navy-950 px-4 py-3 text-sm text-ivory">
      <span className="flex items-center gap-2">
        <AlertTriangle size={16} className="text-gold" />
        It&apos;s been over a week since you reviewed your card prices — the market moves fast, take a look.
      </span>
      <Button
        variant="gold"
        disabled={pending}
        onClick={() => startTransition(async () => { await markPricesReviewed(); })}
      >
        {pending ? "Marking..." : "Mark Prices Reviewed"}
      </Button>
    </div>
  );
}
