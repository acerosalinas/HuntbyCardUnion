import Link from "next/link";
import { DisputeStatusBadge } from "@/components/DisputeStatusBadge";
import { DISPUTE_REASON_LABELS } from "@/lib/disputeLabels";
import { DisputeReason, DisputeStatus } from "@/types/marketplace";

export interface DisputeRowView {
  id: string;
  cardTitle: string;
  reason: DisputeReason;
  status: DisputeStatus;
  createdAt: number;
}

export function DisputesTable({ disputes }: { disputes: DisputeRowView[] }) {
  if (disputes.length === 0) {
    return <p className="py-10 text-center text-sm text-foreground-muted">No disputes.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-card-border">
      <table className="w-full min-w-150 text-left text-sm">
        <thead className="bg-card text-xs uppercase tracking-wide text-foreground-muted">
          <tr>
            <th className="px-4 py-3">Card</th>
            <th className="px-4 py-3">Reason</th>
            <th className="px-4 py-3">Opened</th>
            <th className="px-4 py-3">Status</th>
          </tr>
        </thead>
        <tbody>
          {disputes.map((d) => (
            <tr key={d.id} className="border-t border-card-border">
              <td className="px-4 py-3 font-medium">
                <Link href={`/admin/disputes/${d.id}`} className="hover:text-gold">
                  {d.cardTitle}
                </Link>
              </td>
              <td className="px-4 py-3 text-foreground-muted">{DISPUTE_REASON_LABELS[d.reason]}</td>
              <td className="px-4 py-3 text-foreground-muted">{new Date(d.createdAt).toLocaleDateString()}</td>
              <td className="px-4 py-3">
                <DisputeStatusBadge status={d.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
