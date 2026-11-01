import { CreateAdminForm } from "@/components/admin/CreateAdminForm";
import { AdminsList } from "@/components/admin/AdminsList";
import { BuyersList } from "@/components/admin/BuyersList";
import { listAdmins, listBuyers } from "@/app/admin/accountActions";

export const dynamic = "force-dynamic";

export default async function AdminManagePage() {
  const [admins, buyers] = await Promise.all([listAdmins(), listBuyers()]);
  const waiting = buyers.filter((b) => !b.approved);
  const approved = buyers.filter((b) => b.approved);

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-muted">
          Waiting for approval ({waiting.length})
        </h2>
        {waiting.length > 0 && (
          <p className="text-sm text-foreground-muted">
            These people signed up but can&apos;t see anything until you approve them. Delete removes them for good.
          </p>
        )}
        <BuyersList buyers={waiting} waiting />
      </div>
      <CreateAdminForm />
      <div className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-muted">
          Admins &amp; Super Admins ({admins.length})
        </h2>
        <AdminsList admins={admins} />
      </div>
      <div className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-muted">
          Buyers ({approved.length})
        </h2>
        <BuyersList buyers={approved} />
      </div>
    </div>
  );
}
