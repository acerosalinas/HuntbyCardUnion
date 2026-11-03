"use client";

import { useState, useTransition } from "react";
import { Ban, Check, Trash2 } from "lucide-react";
import { BuyerAccountSummary, deleteBuyer, setBuyerBlocked } from "@/app/admin/accountActions";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { extractErrorMessage } from "@/lib/utils";

/**
 * Buyer roster for the Manage page. Normally it lists everyone using the site (Hold / Delete); with `onHold` it lists
 * the accounts you put on hold (Release / Delete).
 */
export function BuyersList({ buyers, onHold = false }: { buyers: BuyerAccountSummary[]; onHold?: boolean }) {
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const confirm = useConfirm();

  if (buyers.length === 0) {
    return <p className="py-10 text-center text-sm text-foreground-muted">{onHold ? "Nobody is on hold." : "No buyers yet."}</p>;
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

  const handleHold = async (buyer: BuyerAccountSummary) => {
    const confirmed = await confirm({
      title: "Put this account on hold?",
      message: (
        <div className="space-y-2">
          <p>
            <strong>{buyer.email}</strong>
            {buyer.handle ? ` (${buyer.handle})` : ""} won&apos;t be able to browse, make offers or buy until you release them.
          </p>
          <p>Nothing is deleted - their orders and details stay as they are, and you can release the account at any time.</p>
        </div>
      ),
      confirmLabel: "Put on hold",
      tone: "danger",
    });
    if (!confirmed) return;
    run(buyer, (id) => setBuyerBlocked(id, true), "Couldn't put this account on hold.");
  };

  const handleRelease = (buyer: BuyerAccountSummary) => run(buyer, (id) => setBuyerBlocked(id, false), "Couldn't release this account.");

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
              <th scope="col" className="px-4 py-3">Joined</th>
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
                    {buyer.isNew && (
                      <Badge tone="gold" className="ml-2">
                        New
                      </Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 text-foreground-muted">{buyer.fullName ?? "—"}</td>
                  <td className="px-4 py-3 text-foreground-muted">{buyer.handle ?? "—"}</td>
                  <td className="px-4 py-3 text-foreground-muted">{new Date(buyer.createdAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      {onHold ? (
                        <Button variant="primary" disabled={busy} onClick={() => handleRelease(buyer)}>
                          <Check size={14} />
                          Release
                        </Button>
                      ) : (
                        <Button variant="outline" disabled={busy} onClick={() => handleHold(buyer)}>
                          <Ban size={14} />
                          Hold
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
