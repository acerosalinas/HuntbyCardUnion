import { CreateAdminForm } from "@/components/admin/CreateAdminForm";
import { AdminsList } from "@/components/admin/AdminsList";
import { BuyersList } from "@/components/admin/BuyersList";
import { listAdmins, listBuyers } from "@/app/admin/accountActions";
import { requireAdmin } from "@/lib/adminAuth";
import { canUseTracker } from "@/lib/tracker/accessList";
import { createAdminClient } from "@/lib/supabase/admin";
import type { LinkTarget } from "@/app/tracker/customerActions";

export const dynamic = "force-dynamic";

export default async function AdminManagePage() {
  const me = await requireAdmin();
  const [admins, buyers] = await Promise.all([listAdmins(), listBuyers()]);
  const db = createAdminClient();
  const ids = buyers.map((b) => b.id);

  // This admin's own sub usernames for these accounts (private to them; empty until migration_buyer_aliases.sql has been run).
  const aliases: Record<string, string> = {};
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await db.from("buyer_aliases").select("buyer_id, alias").eq("admin_id", me.id).in("buyer_id", ids.slice(i, i + 200));
    for (const r of data ?? []) aliases[r.buyer_id as string] = r.alias as string;
  }

  // Only an admin who has a Live Tracker gets the link column: which of THEIR tracker customers each account is linked to.
  let trackerLinks: Record<string, LinkTarget> | undefined;
  if (canUseTracker(me)) {
    trackerLinks = {};
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await db.from("tracker_customers").select("id, name, buyer_id").eq("owner_id", me.id).in("buyer_id", ids.slice(i, i + 200));
      for (const r of data ?? []) trackerLinks[r.buyer_id as string] = { id: r.id as string, name: r.name as string };
    }
  }
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
          (you can release it later); <strong>Delete</strong> removes it for good; <strong>Make admin</strong> turns a customer into a regular admin.
        </p>
        <BuyersList buyers={active} aliases={aliases} trackerLinks={trackerLinks} />
      </div>
      {onHold.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-muted">On hold ({onHold.length})</h2>
          <BuyersList buyers={onHold} onHold aliases={aliases} />
        </div>
      )}
    </div>
  );
}
