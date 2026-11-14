"use client";

import { useState, useTransition } from "react";
import { Check, X } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { PaymentProofButton } from "@/components/admin/PaymentProofButton";
import { confirmInstallmentPayment, decideInstallmentPlan, rejectInstallmentPayment } from "@/app/admin/installmentActions";
import { readPlan } from "@/lib/claimInstallments";
import { formatShortDate } from "@/lib/tracker/statement";
import { cn, formatCurrency } from "@/lib/utils";

/** What the seller sees of an order's installment plan on Pending Payments. */
export interface ClaimPlanView {
  status: "REQUESTED" | "ACTIVE" | "DECLINED";
  installments: { seq: number; dueDate: string; amount: number }[];
  confirmed: number;
  waiting: number;
  total: number;
  /** Payments sent and not reviewed yet, each with a short-lived link to its screenshot. */
  waitingPayments: { id: string; amount: number; note: string | null; proofUrl: string | null; createdAt: string }[];
}

/** Approve or decline a requested plan, follow an approved one, and confirm or reject each installment screenshot as it arrives. */
export function ClaimPlanPanel({ claimId, title, plan, today }: { claimId: string; title: string; plan: ClaimPlanView; today: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const run = (fn: () => Promise<{ error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (result.error) setError(result.error);
      else {
        setRejecting(null);
        setReason("");
      }
    });
  };

  if (plan.status === "DECLINED") return null;
  const view = readPlan(plan.installments, plan.confirmed, today);

  return (
    <div className={cn("space-y-2 rounded-lg border p-2.5 text-xs", plan.status === "REQUESTED" ? "border-gold/50 bg-gold/10" : "border-card-border bg-foreground/5")}>
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <span className="font-semibold text-foreground">
          {plan.status === "REQUESTED" ? "Installment plan requested" : `Installments · ${formatCurrency(plan.confirmed)} of ${formatCurrency(plan.total)} paid`}
        </span>
        {view.evaluation.overdue && plan.status === "ACTIVE" && <Badge tone="sold">Overdue</Badge>}
      </div>

      <ul className="space-y-0.5 text-foreground-muted">
        {view.evaluation.rows.map((r) => (
          <li key={r.seq} className="flex justify-between gap-2">
            <span>
              {r.seq === 1 && plan.status === "REQUESTED" ? "Today" : formatShortDate(r.dueDate)} · {formatCurrency(r.amount)}
            </span>
            {plan.status === "ACTIVE" && <span className={r.state === "PAID" ? "text-available" : r.state === "OVERDUE" ? "font-semibold text-sold" : ""}>{r.state === "PAID" ? "Paid" : r.state === "OVERDUE" ? "Overdue" : r.state === "DUE" ? "Due today" : "Upcoming"}</span>}
          </li>
        ))}
      </ul>

      {error && <p className="text-sold">{error}</p>}

      {plan.status === "REQUESTED" &&
        (rejecting === "plan" ? (
          <div className="space-y-1.5">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why? The buyer will see it" maxLength={300} autoFocus />
            <div className="flex gap-1.5">
              <Button variant="danger" type="button" disabled={pending} className="px-2 py-1 text-xs" onClick={() => run(() => decideInstallmentPlan(claimId, false, reason))}>
                Decline plan
              </Button>
              <Button variant="outline" type="button" className="px-2 py-1 text-xs" onClick={() => setRejecting(null)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex gap-1.5">
            <Button variant="gold" type="button" disabled={pending} className="px-2 py-1 text-xs" onClick={() => run(() => decideInstallmentPlan(claimId, true))}>
              <Check size={12} /> Approve plan
            </Button>
            <Button variant="outline" type="button" disabled={pending} className="px-2 py-1 text-xs" onClick={() => setRejecting("plan")}>
              <X size={12} /> Decline
            </Button>
          </div>
        ))}

      {plan.status === "ACTIVE" &&
        plan.waitingPayments.map((p) => (
          <div key={p.id} className="space-y-1.5 border-t border-card-border pt-2">
            <p className="font-medium text-foreground">
              {formatCurrency(p.amount)} sent <span className="font-normal text-foreground-muted">· waiting for you</span>
            </p>
            {rejecting === p.id ? (
              <div className="space-y-1.5">
                <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why? The buyer will see it" maxLength={300} autoFocus />
                <div className="flex gap-1.5">
                  <Button variant="danger" type="button" disabled={pending} className="px-2 py-1 text-xs" onClick={() => run(() => rejectInstallmentPayment(p.id, reason))}>
                    Reject
                  </Button>
                  <Button variant="outline" type="button" className="px-2 py-1 text-xs" onClick={() => setRejecting(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {p.proofUrl && <PaymentProofButton url={p.proofUrl} note={p.note} title={`${title} · ${formatCurrency(p.amount)}`} className="px-2 py-1 text-xs" />}
                <Button variant="primary" type="button" disabled={pending} className="px-2 py-1 text-xs" onClick={() => run(() => confirmInstallmentPayment(p.id))}>
                  <Check size={12} /> Confirm {formatCurrency(p.amount)}
                </Button>
                <Button variant="outline" type="button" disabled={pending} className="px-2 py-1 text-xs" onClick={() => setRejecting(p.id)}>
                  Reject
                </Button>
              </div>
            )}
          </div>
        ))}
    </div>
  );
}
