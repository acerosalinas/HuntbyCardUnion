"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { CalendarClock, Check } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { PlanDialog } from "@/components/tracker/PlanDialog";
import { savePlan } from "@/app/tracker/actions";
import { evaluatePlan, Installment } from "@/lib/tracker/installments";
import type { TrackerPlan } from "@/lib/tracker/data";
import { cn, extractErrorMessage, formatCurrency } from "@/lib/utils";

export interface PlanItem {
  id: string;
  status: "REQUESTED" | "ACTIVE";
  requestedBy: "CUSTOMER" | "ADMIN";
  customerId: string;
  customerName: string;
  saleId: string;
  cardName: string;
  liveTitle: string;
  amount: number;
  paid: number;
  note: string | null;
  createdAt: string;
  installments: Installment[];
}

function todayLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function PlansView({ items }: { items: PlanItem[] }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<PlanItem | null>(null);
  const today = todayLocal();

  const requests = items.filter((i) => i.status === "REQUESTED");
  const active = items.filter((i) => i.status === "ACTIVE");

  const approve = (item: PlanItem) => {
    setError(null);
    startTransition(async () => {
      try {
        await savePlan({ saleId: item.saleId, installments: item.installments.map((i) => ({ dueDate: i.dueDate, amount: i.amount })), note: item.note ?? "" });
      } catch (err) {
        setError(extractErrorMessage(err) ?? "Couldn't approve the plan.");
      }
    });
  };

  const asPlan = (item: PlanItem): TrackerPlan => ({
    id: item.id,
    customerId: item.customerId,
    saleId: item.saleId,
    status: item.status,
    requestedBy: item.requestedBy,
    note: item.note,
    declineReason: null,
    createdAt: item.createdAt,
    installments: item.installments,
  });

  return (
    <div className="space-y-6">
      {error && <p className="rounded-lg border border-sold/30 bg-sold-bg px-3 py-2 text-sm text-sold">{error}</p>}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">
          Requests to review <span className="text-xs font-normal text-foreground-muted">{requests.length}</span>
        </h2>
        {requests.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-card-border py-8 text-center text-sm text-foreground-muted">No installment requests waiting.</p>
        ) : (
          requests.map((item) => (
            <div key={item.id} className="rounded-2xl border border-gold/40 bg-card p-4">
              <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                <Link href={`/tracker/customers/${item.customerId}`} className="text-base font-semibold hover:text-gold">
                  {item.customerName}
                </Link>
                <span className="text-foreground-muted">
                  wants to pay <span className="font-medium text-foreground">{item.cardName}</span> ({formatCurrency(item.amount)}) in parts
                </span>
                <span className="ml-auto text-xs text-foreground-muted">{item.createdAt.slice(0, 10)}</span>
              </div>
              <ul className="mb-2 divide-y divide-card-border rounded-xl border border-card-border text-sm">
                {item.installments.map((i) => (
                  <li key={i.seq} className="flex items-center gap-3 px-3 py-1.5">
                    <span className="w-5 text-xs text-foreground-muted">{i.seq}</span>
                    <span className="w-28 text-xs text-foreground-muted">{i.dueDate}</span>
                    <span className="font-medium">{formatCurrency(i.amount)}</span>
                  </li>
                ))}
              </ul>
              {item.note && <p className="mb-2 rounded-lg bg-foreground/5 px-3 py-2 text-xs">&ldquo;{item.note}&rdquo;</p>}
              <div className="flex flex-wrap gap-2">
                <Button variant="gold" type="button" disabled={pending} onClick={() => approve(item)}>
                  <Check size={14} /> Approve as asked
                </Button>
                <Button variant="outline" type="button" disabled={pending} onClick={() => setOpen(item)}>
                  <CalendarClock size={14} /> Edit or decline
                </Button>
              </div>
            </div>
          ))
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">
          Active plans <span className="text-xs font-normal text-foreground-muted">{active.length}</span>
        </h2>
        {active.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-card-border py-8 text-center text-sm text-foreground-muted">
            No active installment plans. Set one up from a customer&apos;s page (the Installments button on a card).
          </p>
        ) : (
          <ul className="space-y-2">
            {active.map((item) => {
              const ev = evaluatePlan(item.installments, item.paid, today);
              const pct = ev.total > 0 ? Math.min(100, Math.round((ev.paid / ev.total) * 100)) : 0;
              return (
                <li key={item.id} className={cn("rounded-2xl border bg-card p-3", ev.overdue ? "border-sold/50" : "border-card-border")}>
                  <div className="mb-1.5 flex flex-wrap items-center gap-2 text-sm">
                    <Link href={`/tracker/customers/${item.customerId}`} className="font-semibold hover:text-gold">
                      {item.customerName}
                    </Link>
                    <span className="text-foreground-muted">
                      {item.cardName} · {formatCurrency(item.amount)}
                    </span>
                    {ev.complete ? (
                      <Badge tone="available">Paid in full</Badge>
                    ) : ev.overdue ? (
                      <Badge tone="sold">Overdue</Badge>
                    ) : ev.dueNow > 0 ? (
                      <Badge tone="pending">{formatCurrency(ev.dueNow)} due now</Badge>
                    ) : ev.next ? (
                      <Badge tone="neutral">
                        Next {formatCurrency(ev.next.amount)} on {ev.next.dueDate}
                      </Badge>
                    ) : null}
                    <button type="button" onClick={() => setOpen(item)} className="ml-auto text-xs text-gold hover:underline">
                      Open
                    </button>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-foreground-muted">
                    <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-foreground/10" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Plan progress">
                      <div className={cn("h-full rounded-full", ev.complete ? "bg-available" : ev.overdue ? "bg-sold" : "bg-gold")} style={{ width: `${pct}%` }} />
                    </div>
                    <span className="shrink-0">
                      {formatCurrency(ev.paid)} of {formatCurrency(ev.total)} · {ev.paidCount}/{ev.count} paid
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {open && <PlanDialog onClose={() => setOpen(null)} card={{ id: open.saleId, name: open.cardName, amount: open.amount, paid: open.paid }} plan={asPlan(open)} today={today} />}
    </div>
  );
}
