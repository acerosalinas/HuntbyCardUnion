import { CreateAdminForm } from "@/components/admin/CreateAdminForm";
import { AdminsList } from "@/components/admin/AdminsList";
import { BuyersList } from "@/components/admin/BuyersList";
import { listAdmins, listBuyers } from "@/app/admin/actions";

export default async function AdminManagePage() {
  const [admins, buyers] = await Promise.all([listAdmins(), listBuyers()]);

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
          Buyers ({buyers.length})
        </h2>
        <BuyersList buyers={buyers} />
      </div>
    </div>
  );
}
