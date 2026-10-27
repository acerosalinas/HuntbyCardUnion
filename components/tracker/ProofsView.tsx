"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Check, ExternalLink, X } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { confirmClaim, rejectClaim } from "@/app/tracker/actions";
import { cn, extractErrorMessage, formatCurrency } from "@/lib/utils";

export interface ProofItem {
  id: string;
  status: "PENDING" | "CONFIRMED" | "REJECTED";
  customerId: string;
  customerName: string;
  buyerHandle: string;
  method: "GCASH" | "MARIBANK";
  cardsAmount: number;
  sfAmount: number;
  note: string | null;
  rejectReason: string | null;
  createdAt: string;
  reviewedAt: string | null;
  /** Short-lived signed link to the private screenshot. */
  proofUrl: string | null;
  cards: { name: string; amount: number; liveTitle: string }[];
}

function todayLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function ProofsView({ items }: { items: ProofItem[] }) {
  const [tab, setTab] = useState<"PENDING" | "DONE">("PENDING");
  const pending = items.filter((i) => i.status === "PENDING");
  const done = items.filter((i) => i.status !== "PENDING");
  const shown = tab === "PENDING" ? pending : done;

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {(
          [
            ["PENDING", "To review", pending.length],
            ["DONE", "Reviewed", done.length],
          ] as const
        ).map(([id, text, count]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
              tab === id ? "border-gold bg-gold/10" : "border-card-border text-foreground-muted hover:text-foreground",
            )}
          >
            {text} <span className="text-xs text-foreground-muted">{count}</span>
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-card-border py-12 text-center text-sm text-foreground-muted">
          {tab === "PENDING" ? "No payment proofs waiting for review." : "Nothing reviewed yet."}
        </p>
      ) : (
        shown.map((item) => <ProofCard key={item.id} item={item} />)
      )}
    </div>
  );
}

function ProofCard({ item }: { item: ProofItem }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [paidOn, setPaidOn] = useState(todayLocal);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  const run = (fn: () => Promise<void>) => {
    setError(null);
    startTransition(async () => {
      try {
        await fn();
      } catch (err) {
        setError(extractErrorMessage(err) ?? "Something went wrong.");
      }
    });
  };

  return (
    <section className="rounded-2xl border border-card-border bg-card p-4">
      <div className="flex flex-col gap-4 sm:flex-row">
        {item.proofUrl ? (
          <a href={item.proofUrl} target="_blank" rel="noreferrer" className="shrink-0" title="Open the full screenshot">
            {/* eslint-disable-next-line @next/next/no-img-element -- private signed URL, not optimisable by next/image */}
            <img src={item.proofUrl} alt={`Payment proof from ${item.customerName}`} className="h-48 w-40 rounded-lg border border-card-border bg-white object-cover object-top" />
            <span className="mt-1 flex items-center justify-center gap-1 text-xs text-foreground-muted">
              <ExternalLink size={11} /> Open full size
            </span>
          </a>
        ) : (
          <div className="flex h-48 w-40 shrink-0 items-center justify-center rounded-lg border border-dashed border-card-border text-xs text-foreground-muted">Screenshot unavailable</div>
        )}

        <div className="min-w-0 flex-1 space-y-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/tracker/customers/${item.customerId}`} className="text-base font-semibold hover:text-gold">
              {item.customerName}
            </Link>
            {item.buyerHandle && <span className="text-xs text-foreground-muted">@{item.buyerHandle}</span>}
            {item.status === "CONFIRMED" && <Badge tone="available">Confirmed</Badge>}
            {item.status === "REJECTED" && <Badge tone="sold">Rejected</Badge>}
            <span className="ml-auto text-xs text-foreground-muted">{item.createdAt.slice(0, 16).replace("T", " ")}</span>
          </div>

          <p>
            <span className="text-lg font-bold">{formatCurrency(item.cardsAmount + item.sfAmount)}</span>{" "}
            <span className="text-foreground-muted">via {item.method === "GCASH" ? "GCash" : "Maribank"}</span>
            {item.sfAmount > 0 && (
              <span className="text-foreground-muted">
                {" "}
                · cards {formatCurrency(item.cardsAmount)} + shipping fee {formatCurrency(item.sfAmount)}
              </span>
            )}
          </p>

          {item.cards.length > 0 ? (
            <ul className="space-y-0.5 text-xs text-foreground-muted">
              {item.cards.map((c, i) => (
                <li key={i} className="flex justify-between gap-2">
                  <span className="truncate">
                    {c.name} {c.liveTitle && <span className="opacity-70">· {c.liveTitle}</span>}
                  </span>
                  <span className="shrink-0">{formatCurrency(c.amount)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-foreground-muted">No cards ticked (shipping fee only).</p>
          )}
          {item.note && <p className="rounded-lg bg-foreground/5 px-3 py-2 text-xs">&ldquo;{item.note}&rdquo;</p>}
          {item.status === "REJECTED" && item.rejectReason && <p className="text-xs text-sold">Reason given: {item.rejectReason}</p>}

          {error && <p className="text-sm text-sold">{error}</p>}

          {item.status === "PENDING" && (
            <div className="space-y-2 border-t border-card-border pt-3">
              {!rejecting ? (
                <div className="flex flex-wrap items-end gap-2">
                  <div>
                    <label className="mb-1 block text-xs text-foreground-muted">Payment date</label>
                    <Input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
                  </div>
                  <Button variant="gold" type="button" disabled={pending} onClick={() => run(() => confirmClaim(item.id, paidOn))}>
                    <Check size={14} /> Confirm payment
                  </Button>
                  <Button variant="outline" type="button" disabled={pending} onClick={() => setRejecting(true)}>
                    <X size={14} /> Reject
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <label className="block text-xs text-foreground-muted">Why? (the customer will see this)</label>
                  <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Amount doesn't match the screenshot" maxLength={300} autoFocus />
                  <div className="flex gap-2">
                    <Button variant="danger" type="button" disabled={pending} onClick={() => run(() => rejectClaim(item.id, reason))}>
                      Reject proof
                    </Button>
                    <Button variant="outline" type="button" onClick={() => setRejecting(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
