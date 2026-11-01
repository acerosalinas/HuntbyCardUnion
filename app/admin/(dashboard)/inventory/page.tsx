import Link from "next/link";
import { UploadCloud } from "lucide-react";
import { InventoryForm } from "@/components/admin/InventoryForm";
import { InventoryScopePicker, ScopeStore } from "@/components/admin/InventoryScopePicker";
import { InventoryView } from "@/components/admin/InventoryView";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/adminAuth";
import { listAdmins } from "@/app/admin/accountActions";
import { resolveInventoryScope, scopeParam } from "@/lib/inventoryScope";
import { CardRow, SellerProfileRow, cardFromRow, sellerProfileFromRow } from "@/types/marketplace";

export const dynamic = "force-dynamic";

export default async function AdminInventoryPage({ searchParams }: { searchParams: Promise<{ store?: string }> }) {
  const admin = await requireAdmin();
  const { store } = await searchParams;
  const supabase = createAdminClient();
  const isSuper = admin.role === "SUPER_ADMIN";

  // Super admin only: the other shops, with how many listings each has, for the picker. Counted per shop with a head
  // query (not by reading every row) so the numbers stay right past the 1000-row API limit.
  let stores: ScopeStore[] = [];
  let myCount = 0;
  let allCount = 0;
  if (isSuper) {
    const admins = await listAdmins();
    const countFor = async (adminId: string | null) => {
      let q = supabase.from("cards").select("id", { count: "exact", head: true });
      if (adminId) q = q.eq("admin_id", adminId);
      const { count } = await q;
      return count ?? 0;
    };
    // Deactivated accounts aren't offered in the dropdown (their listings still show under "All listings").
    const others = admins.filter((a) => a.id !== admin.id && a.active);
    const [{ data: profiles }, mine, all, ...otherCounts] = await Promise.all([
      supabase
        .from("seller_profiles")
        .select("admin_id, display_name")
        .in(
          "admin_id",
          others.map((a) => a.id),
        ),
      countFor(admin.id),
      countFor(null),
      ...others.map((a) => countFor(a.id)),
    ]);
    const nameByAdmin = new Map((profiles ?? []).map((r) => [r.admin_id as string, r.display_name as string]));
    myCount = mine;
    allCount = all;
    stores = others.map((a, i) => ({ id: a.id, label: nameByAdmin.get(a.id) || a.handle || a.email, count: otherCounts[i] }));
  }

  const scope = resolveInventoryScope(
    store,
    isSuper,
    stores.map((s) => s.id),
  );
  let query = supabase.from("cards").select("*").order("created_at", { ascending: false });
  if (scope.kind === "mine") query = query.eq("admin_id", admin.id);
  else if (scope.kind === "store") query = query.eq("admin_id", scope.adminId);

  const [{ data }, { data: profileRow }] = await Promise.all([
    query,
    supabase.from("seller_profiles").select("*").eq("admin_id", admin.id).maybeSingle(),
  ]);
  const cards = ((data as CardRow[] | null) ?? []).map(cardFromRow);
  const sellerProfile = profileRow ? sellerProfileFromRow(profileRow as SellerProfileRow) : null;
  const param = scopeParam(scope);
  const viewing = scope.kind === "store" ? stores.find((s) => s.id === scope.adminId)?.label : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {isSuper ? <InventoryScopePicker value={param ?? "mine"} myCount={myCount} stores={stores} allCount={allCount} /> : <span />}
        <Link
          href="/admin/inventory/bulk-upload"
          className="inline-flex items-center gap-1.5 rounded-lg border border-gold/40 bg-navy-950 px-3 py-1.5 text-sm font-medium text-gold transition-colors hover:bg-gold/10"
        >
          <UploadCloud size={14} />
          Bulk Upload
        </Link>
      </div>
      {scope.kind !== "mine" && (
        <p className="rounded-lg border border-gold/40 bg-gold/10 px-3 py-2 text-sm text-foreground">
          {scope.kind === "all" ? "You're viewing every shop's listings." : `You're viewing ${viewing ?? "another shop"}'s listings.`} Listings you add with
          the form below still go to your own shop.
        </p>
      )}
      <InventoryForm sellerProfile={sellerProfile} />
      <InventoryView key={param ?? "mine"} cards={cards} />
    </div>
  );
}
