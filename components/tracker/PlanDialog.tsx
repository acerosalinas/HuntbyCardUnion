"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { PlanEditor } from "@/components/tracker/PlanEditor";
import { cancelPlan, declinePlan, savePlan } from "@/app/tracker/actions";
import { evaluatePlan } from "@/lib/tracker/installments";
import type { TrackerPlan } from "@/lib/tracker/data";
import { cn, extractErrorMessage, formatCurrency } from "@/lib/utils";

interface Props {
  onClose: () => void;
  card: { id: string; name: string; amount: number; paid: number };
  plan: TrackerPlan | null;
  today: string;
}

/** Enter a card's installment plan, or review / edit / approve / decline one the customer asked for. */
export function PlanDialog({ onClose, card, plan, today }: Props) {
  return (
    <Modal open onClose={onClose} title={`Installment plan - ${card.name}`} className="max-w-lg">
      <PlanDialogBody onClose={onClose} card={card} plan={plan} today={today} />
    </Modal>
  );
}

function PlanDialogBody({ onClose, card, plan, today }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");

  const requested = plan?.status === "REQUESTED";
  const active = plan?.status === "ACTIVE";
  const evaluation = active && plan ? evaluatePlan(plan.installments, card.paid, today) : null;

  const run = (fn: () => Promise<void>) => {
    setError(null);
    startTransition(async () => {
      try {
        await fn();
        onClose();
      } catch (err) {
        setError(extractErrorMessage(err) ?? "Something went wrong.");
      }
    });
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-foreground-muted">
        Card price <span className="font-semibold text-foreground">{formatCurrency(card.amount)}</span> · paid so far{" "}
        <span className="font-semibold text-foreground">{formatCurrency(card.paid)}</span>
      </p>

      {requested && (
        <div className="rounded-lg border border-gold/40 bg-gold/10 px-3 py-2 text-sm">
          <Badge tone="gold">Customer request</Badge>
          <p className="mt-1 text-xs text-foreground-muted">Below is the schedule they asked for. Approve it as it is, change it first, or decline.</p>
          {plan?.note && <p className="mt-1 text-xs">&ldquo;{plan.note}&rdquo;</p>}
        </div>
      )}

      {evaluation && (
        <ul className="divide-y divide-card-border rounded-xl border border-card-border text-sm">
          {evaluation.rows.map((r) => (
            <li key={r.seq} className="flex items-center gap-2 px-3 py-1.5">
              <span className="w-5 text-xs text-foreground-muted">{r.seq}</span>
              <span className="w-24 text-xs text-foreground-muted">{r.dueDate}</span>
              <span className="font-medium">{formatCurrency(r.amount)}</span>
              <span className="ml-auto">
                {r.state === "PAID" && <Badge tone="available">Paid</Badge>}
                {r.state === "OVERDUE" && <Badge tone="sold">Overdue{r.covered > 0 ? ` · ${formatCurrency(r.amount - r.covered)} left` : ""}</Badge>}
                {r.state === "DUE" && <Badge tone="pending">Due today</Badge>}
                {r.state === "UPCOMING" && <Badge tone="neutral">Upcoming</Badge>}
              </span>
            </li>
          ))}
        </ul>
      )}

      {!declining ? (
        <PlanEditor
          key={plan?.id ?? "new"}
          cardAmount={card.amount}
          initial={plan?.installments.map((i) => ({ dueDate: i.dueDate, amount: i.amount }))}
          initialNote={plan?.note ?? ""}
          submitLabel={requested ? "Approve plan" : active ? "Save changes" : "Create plan"}
          pending={pending}
          error={error}
          onSubmit={(installments, note) => run(() => savePlan({ saleId: card.id, installments, note }))}
          extra={
            <>
              {requested && (
                <Button type="button" variant="outline" disabled={pending} onClick={() => setDeclining(true)}>
                  Decline
                </Button>
              )}
              {active && plan && (
                <Button type="button" variant="outline" disabled={pending} onClick={() => run(() => cancelPlan(plan.id))}>
                  End plan
                </Button>
              )}
              <Button type="button" variant="outline" onClick={onClose}>
                Close
              </Button>
            </>
          }
        />
      ) : (
        <div className="space-y-2">
          <label className="block text-xs text-foreground-muted">Why? (the customer will see this)</label>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Please pay this one in full" maxLength={300} autoFocus />
          {error && <p className="text-sm text-sold">{error}</p>}
          <div className="flex gap-2">
            <Button type="button" variant="danger" disabled={pending} onClick={() => plan && run(() => declinePlan(plan.id, reason))}>
              Decline request
            </Button>
            <Button type="button" variant="outline" onClick={() => setDeclining(false)}>
              Back
            </Button>
          </div>
        </div>
      )}
      <p className={cn("text-xs text-foreground-muted", declining && "hidden")}>
        Payments are still recorded the usual way (tick the card, <span className="font-medium">Paid</span>, or confirm a customer proof). The plan just keeps track of which installment each payment covers.
      </p>
    </div>
  );
}
