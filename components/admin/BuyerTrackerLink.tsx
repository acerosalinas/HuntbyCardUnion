"use client";

import { FormEvent, useState, useTransition } from "react";
import { Link2, Link2Off } from "lucide-react";
import { findLinkTargets, LinkTarget, setBuyerLink } from "@/app/tracker/customerActions";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";

/**
 * Link or unlink a customer account to one of YOUR Live Tracker customers, from the Buyers list. A linked customer sees their own cards,
 * balance and shipping under My Live Orders. Same rules as the Customer account panel on a tracker customer.
 */
export function BuyerTrackerLink({ buyerId, handle, linked }: { buyerId: string; handle: string | null; linked: LinkTarget | null }) {
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LinkTarget[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const confirm = useConfirm();

  const change = (customerId: string | null) =>
    startTransition(async () => {
      setError(null);
      const result = await setBuyerLink(buyerId, customerId);
      if (result.error) return setError(result.error);
      setOpen(false);
      setQuery("");
      setResults(null);
    });

  const unlink = async () => {
    if (!linked) return;
    const ok = await confirm({
      title: "Unlink this customer?",
      message: `${handle ?? "This account"} will no longer see ${linked.name}'s orders under My Live Orders. Nothing is deleted from your tracker.`,
      confirmLabel: "Unlink",
      tone: "danger",
    });
    if (ok) change(null);
  };

  const search = (e: FormEvent) => {
    e.preventDefault();
    startTransition(async () => setResults(await findLinkTargets(query)));
  };

  if (linked) {
    return (
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 text-xs font-medium text-available">
            <Link2 size={12} aria-hidden="true" />
            {linked.name}
          </span>
          <Button variant="outline" className="px-2 py-1 text-xs" disabled={pending} onClick={unlink}>
            <Link2Off size={12} />
            Unlink
          </Button>
        </div>
        {error && <p className="text-xs text-sold">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {!open ? (
        <Button variant="outline" className="px-2 py-1 text-xs" onClick={() => setOpen(true)}>
          <Link2 size={12} />
          Link to tracker customer
        </Button>
      ) : (
        <div className="space-y-1.5">
          <form onSubmit={search} className="flex gap-1.5">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Their name in your tracker"
              aria-label="Search your tracker customers by name"
              maxLength={60}
              className="w-44 rounded-md border border-card-border bg-background-elevated px-2 py-1 text-base outline-none focus:border-gold sm:text-xs"
            />
            <Button type="submit" variant="outline" className="px-2 py-1 text-xs" disabled={pending || query.trim().length < 2}>
              Search
            </Button>
            <Button type="button" variant="outline" className="px-2 py-1 text-xs" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </form>
          {results && results.length === 0 && <p className="text-xs text-foreground-muted">No unlinked customer in your tracker has that name.</p>}
          {results && results.length > 0 && (
            <ul className="divide-y divide-card-border rounded-lg border border-card-border text-xs">
              {results.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 px-2 py-1.5">
                  <span>{r.name}</span>
                  <Button variant="gold" className="px-2 py-0.5 text-xs" disabled={pending} onClick={() => change(r.id)}>
                    Link
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {error && <p className="text-xs text-sold">{error}</p>}
    </div>
  );
}
