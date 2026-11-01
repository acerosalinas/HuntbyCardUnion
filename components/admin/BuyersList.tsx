"use client";

import { useState, useTransition } from "react";
import { Check, Trash2 } from "lucide-react";
import { approveBuyer, BuyerAccountSummary, deleteBuyer } from "@/app/admin/accountActions";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { extractErrorMessage } from "@/lib/utils";

/**
 * Buyer roster for the Manage page. `waiting` shows the people who signed up and are waiting for approval (Approve /
 * Delete); otherwise it shows everyone already let in (Delete only).
 */
export function BuyersList({ buyers, waiting = false }: { buyers: BuyerAccountSummary[]; waiting?: boolean }) {
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const confirm = useConfirm();

  if (buyers.length === 0) {
    return <p className="py-10 text-center text-sm text-foreground-muted">{waiting ? "Nobody is waiting for approval." : "No approved buyers yet."}</p>;
  }

  const run = (buyer: BuyerAccountSummary, action: (id: string) => Promise<{ error?: string }>, fallback: string) => {
    setError(null);
    setBusyId(buyer.id);
    startTransition(async () => {
      try {
        const result = await action(buyer.id);
        if (result.error) setError(result.error);
      } catch (err) {
        setError(extractErrorMessage(err) ?? fallback);
      } finally {
        setBusyId(null);
      }
    });
  };

  const handleApprove = (buyer: BuyerAccountSummary) => run(buyer, approveBuyer, "Couldn't approve this account.");

  const handleDelete = async (buyer: BuyerAccountSummary) => {
    const confirmed = await confirm({
      title: "Delete this account permanently?",
      message: (
        <div className="space-y-2">
          <p>
            <strong>{buyer.email}</strong>
            {buyer.handle ? ` (${buyer.handle})` : ""} will be deleted for good and can no longer sign in.
          </p>
          <p>Their past orders and offers stay in your records. If they try to come back, they&apos;ll be told to message you on TikTok or Facebook.</p>
        </div>
      ),
      confirmLabel: "Delete permanently",
      tone: "danger",
    });
    if (!confirmed) return;
    run(buyer, deleteBuyer, "Couldn't delete this account.");
  };

  return (
    <div className="space-y-2">
      {error && <p className="text-sm text-sold">{error}</p>}
      <div className="overflow-x-auto rounded-2xl border border-card-border">
        <table className="w-full min-w-180 text-left text-sm">
          <thead className="bg-card text-xs uppercase tracking-wide text-foreground-muted">
            <tr>
              <th scope="col" className="px-4 py-3">Email</th>
              <th scope="col" className="px-4 py-3">Name</th>
              <th scope="col" className="px-4 py-3">Handle</th>
              <th scope="col" className="px-4 py-3">{waiting ? "Signed up" : "Joined"}</th>
              <th scope="col" className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {buyers.map((buyer) => {
              const busy = pending && busyId === buyer.id;
              return (
                <tr key={buyer.id} className="border-t border-card-border">
                  <td className="px-4 py-3 font-medium">
                    {buyer.email}
                    {buyer.removedBefore && (
                      <Badge tone="sold" className="ml-2">
                        Removed before
                      </Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 text-foreground-muted">{buyer.fullName ?? "—"}</td>
                  <td className="px-4 py-3 text-foreground-muted">{buyer.handle ?? "—"}</td>
                  <td className="px-4 py-3 text-foreground-muted">{new Date(buyer.createdAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      {waiting && (
                        <Button variant="primary" disabled={busy} onClick={() => handleApprove(buyer)}>
                          <Check size={14} />
                          Approve
                        </Button>
                      )}
                      <Button variant="danger" disabled={busy} onClick={() => handleDelete(buyer)}>
                        <Trash2 size={14} />
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
