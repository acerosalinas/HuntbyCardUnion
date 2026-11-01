"use client";

import Link from "next/link";
import { useState } from "react";
import { Wallet } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { CardPaymentDialog } from "@/components/tracker/CardPaymentDialog";
import type { TrackerPayment } from "@/lib/tracker/data";
import { cn, formatCurrency } from "@/lib/utils";

export interface LogItem {
  saleId: string;
  customerId: string;
  customerName: string;
  cardName: string;
  liveId: string;
  liveTitle: string;
  amount: number;
  paid: number;
  /** Date of the most recent payment recorded against this card, or null when it was paid through general payments only. */
  lastPaidOn: string | null;
  paymentCount: number;
  planStatus: "ACTIVE" | "REQUESTED" | null;
}

interface Props {
  /** Cards that have been paid in part and still owe something. */
  partial: LogItem[];
  /** Cards paid off in two or more payments, most recent first. */
  completed: LogItem[];
  /** CARDS payments for the customers shown above, so a card's payment log can be opened from here. */
  paymentsByCustomer: Record<string, TrackerPayment[]>;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function Row({ item, onOpen, done }: { item: LogItem; onOpen: () => void; done?: boolean }) {
  const left = round2(item.amount - item.paid);
  const pct = item.amount > 0 ? Math.min(100, Math.round((item.paid / item.amount) * 100)) : 0;
  return (
    <li className="rounded-2xl border border-card-border bg-card p-3">
      <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <Link href={`/tracker/customers/${item.customerId}`} className="font-semibold hover:text-gold">
          {item.customerName}
        </Link>
        <span className="min-w-0 truncate text-foreground-muted">
          {item.cardName} · {formatCurrency(item.amount)}
        </span>
        {done ? <Badge tone="available">Paid in full</Badge> : <Badge tone="pending">Partially paid</Badge>}
        {item.planStatus === "ACTIVE" && <Badge tone="neutral">Has due dates</Badge>}
        <button
          type="button"
          onClick={onOpen}
          className="ml-auto inline-flex items-center gap-1 rounded-md border border-gold/50 px-2 py-1 text-xs font-medium text-foreground hover:bg-gold/10"
        >
          <Wallet size={12} /> {done ? "Payment log" : "Add payment"}
        </button>
      </div>
      <div className="flex items-center gap-2 text-xs text-foreground-muted">
        <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-foreground/10" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Paid so far">
          <div className={cn("h-full rounded-full", done ? "bg-available" : "bg-gold")} style={{ width: `${pct}%` }} />
        </div>
        <span className="shrink-0 tabular-nums">
          {formatCurrency(item.paid)} of {formatCurrency(item.amount)}
          {!done && <> · <span className="font-semibold text-pending">{formatCurrency(left)} left</span></>}
        </span>
      </div>
      <p className="mt-1 text-xs text-foreground-muted">
        {item.liveTitle && <>{item.liveTitle} · </>}
        {item.paymentCount > 0 ? `${item.paymentCount} payment${item.paymentCount === 1 ? "" : "s"}` : "paid through general payments"}
        {item.lastPaidOn && <> · last on {item.lastPaidOn}</>}
      </p>
    </li>
  );
}

/** The log of cards being paid in parts: who still owes what, and which cards were paid off in installments. */
export function InstallmentLog({ partial, completed, paymentsByCustomer }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = openId ? [...partial, ...completed].find((i) => i.saleId === openId) ?? null : null;

  return (
    <>
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold">
            Partially paid cards <span className="text-xs font-normal text-foreground-muted">{partial.length}</span>
          </h2>
          <p className="text-xs text-foreground-muted">Cards a customer is paying in parts. Add a payment here (or on the customer&apos;s page) whenever the next one arrives.</p>
        </div>
        {partial.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-card-border py-8 text-center text-sm text-foreground-muted">
            No partially paid cards. On a customer&apos;s page, tap <span className="font-medium text-foreground">Add payment</span> on a card and enter what they paid.
          </p>
        ) : (
          <ul className="space-y-2">
            {partial.map((item) => (
              <Row key={item.saleId} item={item} onOpen={() => setOpenId(item.saleId)} />
            ))}
          </ul>
        )}
      </section>

      {completed.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">
            Recently paid off in parts <span className="text-xs font-normal text-foreground-muted">{completed.length}</span>
          </h2>
          <ul className="space-y-2">
            {completed.map((item) => (
              <Row key={item.saleId} item={item} done onOpen={() => setOpenId(item.saleId)} />
            ))}
          </ul>
        </section>
      )}

      {open && (
        <CardPaymentDialog
          onClose={() => setOpenId(null)}
          customer={{ id: open.customerId, name: open.customerName }}
          card={{ id: open.saleId, name: open.cardName, amount: open.amount, paid: open.paid, liveId: open.liveId }}
          payments={paymentsByCustomer[open.customerId] ?? []}
        />
      )}
    </>
  );
}
