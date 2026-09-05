import { BuyerAccountSummary } from "@/app/admin/actions";

/** Read-only roster - buyers have no account-management actions on this page (see listBuyers() in app/admin/actions.ts for why). */
export function BuyersList({ buyers }: { buyers: BuyerAccountSummary[] }) {
  if (buyers.length === 0) {
    return <p className="py-10 text-center text-sm text-foreground-muted">No buyer accounts yet.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-card-border">
      <table className="w-full min-w-140 text-left text-sm">
        <thead className="bg-card text-xs uppercase tracking-wide text-foreground-muted">
          <tr>
            <th className="px-4 py-3">Email</th>
            <th className="px-4 py-3">Name</th>
            <th className="px-4 py-3">Handle</th>
            <th className="px-4 py-3">Joined</th>
          </tr>
        </thead>
        <tbody>
          {buyers.map((buyer) => (
            <tr key={buyer.id} className="border-t border-card-border">
              <td className="px-4 py-3 font-medium">{buyer.email}</td>
              <td className="px-4 py-3 text-foreground-muted">{buyer.fullName ?? "—"}</td>
              <td className="px-4 py-3 text-foreground-muted">{buyer.handle ?? "—"}</td>
              <td className="px-4 py-3 text-foreground-muted">{new Date(buyer.createdAt).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
