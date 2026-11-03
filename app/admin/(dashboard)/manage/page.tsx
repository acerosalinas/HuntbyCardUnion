import { CreateAdminForm } from "@/components/admin/CreateAdminForm";
import { AdminsList } from "@/components/admin/AdminsList";
import { BuyersList } from "@/components/admin/BuyersList";
import { listAdmins, listBuyers } from "@/app/admin/accountActions";

export const dynamic = "force-dynamic";

export default async function AdminManagePage() {
  const [admins, buyers] = await Promise.all([listAdmins(), listBuyers()]);
  const active = buyers.filter((b) => !b.blocked);
  const onHold = buyers.filter((b) => b.blocked);

  return (
    <div className="space-y-8">
      <CreateAdminForm />
      <div className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-muted">
          Admins &amp; Super Admins ({admins.length})
        </h2>
        <AdminsList admins={admins} />
      </div>
      <div className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-muted">
          Buyers ({active.length})
        </h2>
        <p className="text-sm text-foreground-muted">
          Anyone can sign up and start right away. Newest first, with a <strong>New</strong> tag for the first week. <strong>Hold</strong> stops an account from browsing or buying
          (you can release it later); <strong>Delete</strong> removes it for good.
        </p>
        <BuyersList buyers={active} />
      </div>
      {onHold.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-muted">On hold ({onHold.length})</h2>
          <BuyersList buyers={onHold} onHold />
        </div>
      )}
    </div>
  );
}
