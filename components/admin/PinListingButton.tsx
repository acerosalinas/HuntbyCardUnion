"use client";

import { useState, useTransition } from "react";
import { Pin, PinOff } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { setListingPinned } from "@/app/admin/cardActions";
import { cn } from "@/lib/utils";

/** Pin a listing to the top of the seller's shop, or take the pin off. The list refreshes by itself once it's saved. */
export function PinListingButton({ cardId, pinned, compact = false }: { cardId: string; pinned: boolean; compact?: boolean }) {
  const [pending, startTransition] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);
  const click = () =>
    startTransition(async () => {
      setProblem(null);
      const result = await setListingPinned(cardId, !pinned);
      if (result.error) setProblem(result.error);
    });
  return (
    <>
      <Button
        variant="outline"
        disabled={pending}
        onClick={click}
        aria-pressed={pinned}
        title={pinned ? "Unpin this listing from the top of your shop" : "Keep this listing at the top of your shop"}
        className={cn(compact ? "gap-1 px-2 py-1.5 text-xs" : "", pinned && "border-gold/60 text-gold-ink")}
      >
        {pinned ? <PinOff size={compact ? 13 : 14} /> : <Pin size={compact ? 13 : 14} />}
        {pending ? "Saving..." : pinned ? "Unpin" : "Pin to top"}
      </Button>
      {problem && <span className="basis-full text-xs text-sold">{problem}</span>}
    </>
  );
}
