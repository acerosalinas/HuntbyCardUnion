import { CreateAdminForm } from "@/components/admin/CreateAdminForm";
import { AdminsList } from "@/components/admin/AdminsList";
import { listAdmins } from "@/app/admin/actions";

export default async function AdminManagePage() {
  const admins = await listAdmins();

  return (
    <div className="space-y-6">
      <CreateAdminForm />
      <AdminsList admins={admins} />
    </div>
  );
}
