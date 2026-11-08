"use client";

import { useState, useTransition } from "react";
import { Link2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { linkSuggested } from "@/app/tracker/customerActions";
import type { LinkSuggestion } from "@/lib/tracker/marketplaceLink";
import { extractErrorMessage } from "@/lib/utils";

/**
 * Marketplace accounts that look like customers who aren't linked yet (same name as the @handle or the account's full name). Linking gives
 * the account that customer's whole ledger, so nothing is linked on its own - each match is confirmed here, one by one or all together.
 */
export function LinkSuggestions({ suggestions }: { suggestions: LinkSuggestion[] }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());

  const open = suggestions.filter((s) => !done.has(s.customerId));
  if (open.length === 0) return null;

  const link = (list: LinkSuggestion[]) => {
    setError(null);
    startTransition(async () => {
      try {
        const result = await linkSuggested(list.map((s) => ({ customerId: s.customerId, buyerId: s.buyerId })));
        setDone((prev) => new Set([...prev, ...result.linked]));
        if (result.firstError) setError(result.firstError);
      } catch (err) {
        setError(extractErrorMessage(err) ?? "Couldn't link them.");
      }
    });
  };

  return (
    <section className="rounded-2xl border border-gold/40 bg-gold/5 p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">
          {open.length} customer{open.length === 1 ? "" : "s"} may already have an account
        </h2>
        {open.length > 1 && (
          <Button variant="gold" type="button" className="px-3 py-1.5 text-xs" disabled={pending} onClick={() => link(open)}>
            <Link2 size={13} /> Link all {open.length}
          </Button>
        )}
      </div>
      <p className="mb-3 text-xs text-foreground-muted">
        Linking lets them see their live orders in their account, and shows their marketplace orders here. Only link ones you recognise.
      </p>
      <ul className="divide-y divide-card-border rounded-xl border border-card-border bg-card text-sm">
        {open.map((s) => (
          <li key={s.customerId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
            <span className="min-w-0 flex-1">
              <span className="font-medium">{s.customerName}</span>
              <span className="text-foreground-muted">
                {" "}
                → {s.handle} ({s.fullName}) · matched on {s.reason === "handle" ? "the handle" : "the full name"}
              </span>
            </span>
            <Button variant="outline" type="button" className="px-3 py-1 text-xs" disabled={pending} onClick={() => link([s])}>
              Link
            </Button>
          </li>
        ))}
      </ul>
      {error && <p className="mt-2 text-sm text-sold">{error}</p>}
    </section>
  );
}
