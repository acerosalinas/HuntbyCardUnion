"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Check, ExternalLink, X } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { confirmPaidMany, rejectOrderProof } from "@/app/admin/orderActions";
import { extractErrorMessage, formatCurrency } from "@/lib/utils";

/** A payment screenshot a buyer sent for marketplace orders. One screenshot can cover several orders, so they are reviewed together. */
export interface MarketProofItem {
  key: string;
  buyerHandle: string;
  /** The tracker customer this buyer is linked to, when they are. */
  customerId: string | null;
  customerName: string | null;
  note: string | null;
  uploadedAt: string;
  /** yyyy-mm-dd the screenshot was sent (Philippine time). */
  day: string;
  /** Short-lived signed link to the private screenshot. */
  proofUrl: string | null;
  total: number;
  claims: { id: string; title: string; packNumber: number | null; amount: number }[];
}

export function MarketProofCard({ item }: { item: MarketProofItem }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const ids = item.claims.map((c) => c.id);

  const confirm = () => {
    setError(null);
    startTransition(async () => {
      try {
        const result = await confirmPaidMany(ids);
        if (result.failed > 0) setError(result.firstError ?? "Some orders couldn't be confirmed.");
      } catch (err) {
        setError(extractErrorMessage(err) ?? "Something went wrong.");
      }
    });
  };

  const reject = () => {
    setError(null);
    startTransition(async () => {
      const result = await rejectOrderProof(ids, reason);
      if (result.error) setError(result.error);
    });
  };

  return (
    <section className="rounded-2xl border border-card-border bg-card p-4">
      <div className="flex flex-col gap-4 sm:flex-row">
        {item.proofUrl ? (
          <a href={item.proofUrl} target="_blank" rel="noreferrer" className="shrink-0" title="Open the full screenshot">
            {/* eslint-disable-next-line @next/next/no-img-element -- private signed URL, not optimisable by next/image */}
            <img src={item.proofUrl} alt={`Payment proof from ${item.buyerHandle}`} className="h-48 w-40 rounded-lg border border-card-border bg-white object-cover object-top" />
            <span className="mt-1 flex items-center justify-center gap-1 text-xs text-foreground-muted">
              <ExternalLink size={11} /> Open full size
            </span>
          </a>
        ) : (
          <div className="flex h-48 w-40 shrink-0 items-center justify-center rounded-lg border border-dashed border-card-border text-xs text-foreground-muted">Screenshot unavailable</div>
        )}

        <div className="min-w-0 flex-1 space-y-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            {item.customerId ? (
              <Link href={`/tracker/customers/${item.customerId}`} className="text-base font-semibold hover:text-gold">
                {item.customerName}
              </Link>
            ) : (
              <span className="text-base font-semibold">{item.buyerHandle}</span>
            )}
            {item.customerId && <span className="text-xs text-foreground-muted">@{item.buyerHandle.replace(/^@/, "")}</span>}
            <Badge tone="neutral">Marketplace</Badge>
            <span className="ml-auto text-xs text-foreground-muted">{item.uploadedAt.slice(0, 16).replace("T", " ")}</span>
          </div>

          <p>
            <span className="text-lg font-bold">{formatCurrency(item.total)}</span>{" "}
            <span className="text-foreground-muted">
              for {item.claims.length} order{item.claims.length === 1 ? "" : "s"}
            </span>
          </p>

          <ul className="space-y-0.5 rounded-lg border border-card-border px-2.5 py-1.5 text-xs text-foreground-muted">
            {item.claims.map((c) => (
              <li key={c.id} className="flex justify-between gap-2">
                <span className="truncate">
                  {c.title}
                  {c.packNumber !== null && <span className="opacity-70"> · Pack #{c.packNumber}</span>}
                </span>
                <span className="shrink-0">{formatCurrency(c.amount)}</span>
              </li>
            ))}
          </ul>
          {item.note && <p className="rounded-lg bg-foreground/5 px-3 py-2 text-xs">&ldquo;{item.note}&rdquo;</p>}
          {error && <p className="text-sm text-sold">{error}</p>}

          <div className="space-y-2 border-t border-card-border pt-3">
            {!rejecting ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="gold" type="button" disabled={pending} onClick={confirm}>
                  <Check size={14} /> Confirm payment
                </Button>
                <Button variant="outline" type="button" disabled={pending} onClick={() => setRejecting(true)}>
                  <X size={14} /> Reject
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <label className="block text-xs text-foreground-muted">Why? (the buyer will see this)</label>
                <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Amount doesn't match the screenshot" maxLength={300} autoFocus />
                <div className="flex gap-2">
                  <Button variant="danger" type="button" disabled={pending} onClick={reject}>
                    Reject proof
                  </Button>
                  <Button variant="outline" type="button" onClick={() => setRejecting(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
