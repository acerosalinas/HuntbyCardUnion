"use client";

import { useState, useTransition } from "react";
import { BellRing } from "lucide-react";
import { remindOwingCustomers, ReminderResult } from "@/app/tracker/noticeActions";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { formatCurrency } from "@/lib/utils";
import { REMINDER_COOLDOWN_HOURS } from "@/lib/tracker/reminder";

/**
 * "Remind everyone who owes": first shows who would be reminded (and who can't be reached), then sends one combined reminder each,
 * in the app and by email. Nobody is reminded twice within a day.
 */
export function RemindAllButton() {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const confirm = useConfirm();

  const run = () =>
    startTransition(async () => {
      setMessage(null);
      const preview = await remindOwingCustomers({ dryRun: true });
      if (preview.error) return setMessage({ text: preview.error, ok: false });
      if (preview.reminded === 0) {
        const why = [
          preview.recentlyReminded > 0 ? `${preview.recentlyReminded} already reminded in the last ${REMINDER_COOLDOWN_HOURS} hours` : null,
          preview.unreachable.length > 0 ? `${preview.unreachable.length} not linked to an account (${preview.unreachable.slice(0, 5).join(", ")}${preview.unreachable.length > 5 ? "…" : ""})` : null,
        ].filter(Boolean);
        return setMessage({ text: `Nobody to remind right now${why.length ? ` - ${why.join("; ")}` : ""}.`, ok: true });
      }
      const ok = await confirm({
        title: `Remind ${preview.reminded} customer${preview.reminded === 1 ? "" : "s"}?`,
        message: <ReminderSummary preview={preview} />,
        confirmLabel: "Send reminders",
      });
      if (!ok) return;
      const sent = await remindOwingCustomers({});
      if (sent.error) return setMessage({ text: sent.error, ok: false });
      setMessage({
        text: `Reminded ${sent.reminded} customer${sent.reminded === 1 ? "" : "s"} (${formatCurrency(sent.totalOwed)} owed)${sent.emailed > 0 ? `, ${sent.emailed} also by email` : ""}.`,
        ok: true,
      });
    });

  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <Button variant="outline" type="button" disabled={pending} onClick={run}>
        <BellRing size={14} />
        {pending ? "Checking..." : "Remind everyone who owes"}
      </Button>
      {message && (
        <p role="status" className={message.ok ? "max-w-sm text-xs text-foreground-muted sm:text-right" : "max-w-sm text-xs text-sold sm:text-right"}>
          {message.text}
        </p>
      )}
    </div>
  );
}

function ReminderSummary({ preview }: { preview: ReminderResult }) {
  return (
    <div className="space-y-2 text-sm">
      <p>
        Each gets one reminder in the app and by email with what they owe - <strong>{formatCurrency(preview.totalOwed)}</strong> in total. That covers unpaid cards from your lives and pay-now marketplace orders on your cards.
      </p>
      {preview.marketplaceOnly > 0 && (
        <p>{preview.marketplaceOnly} of them only owe on marketplace orders (they aren&apos;t in your tracker).</p>
      )}
      {preview.recentlyReminded > 0 && (
        <p>
          {preview.recentlyReminded} skipped - reminded in the last {REMINDER_COOLDOWN_HOURS} hours.
        </p>
      )}
      {preview.unreachable.length > 0 && (
        <p>
          <strong>{preview.unreachable.length} can&apos;t be reached</strong> because they aren&apos;t linked to an account: {preview.unreachable.slice(0, 8).join(", ")}
          {preview.unreachable.length > 8 ? ` and ${preview.unreachable.length - 8} more` : ""}. Copy their balance from the list and send it yourself.
        </p>
      )}
    </div>
  );
}
