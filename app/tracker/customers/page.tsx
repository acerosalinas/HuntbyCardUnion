import { requireTrackerAdminOrRedirect } from "@/lib/tracker/auth";
import { loadTrackerData } from "@/lib/tracker/data";
import { CustomersView, CustomerRow } from "@/components/tracker/CustomersView";
import { LinkSuggestions } from "@/components/tracker/LinkSuggestions";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadMarketplaceClaims } from "@/lib/tracker/marketplaceData";
import { marketplaceSummary, suggestLinks } from "@/lib/tracker/marketplaceLink";

export const dynamic = "force-dynamic";

export default async function TrackerCustomersPage() {
  const admin = await requireTrackerAdminOrRedirect();
  const data = await loadTrackerData(admin.id);

  const lastPaymentByCustomer = new Map<string, string>();
  for (const p of data.payments) {
    const current = lastPaymentByCustomer.get(p.customerId);
    if (!current || p.paidOn > current) lastPaymentByCustomer.set(p.customerId, p.paidOn);
  }

  // Marketplace orders of the customers who are linked to an account, so the list shows what each person owes across both.
  const db = createAdminClient();
  const linkedBuyerIds = data.customers.map((c) => c.buyerId).filter((id): id is string => Boolean(id));
  const marketClaims = await loadMarketplaceClaims(db, admin.id, linkedBuyerIds);
  const marketUnpaidByBuyer = new Map<string, number>();
  for (const buyerId of linkedBuyerIds) marketUnpaidByBuyer.set(buyerId, marketplaceSummary(marketClaims.filter((c) => c.buyerId === buyerId)).unpaid);

  // Accounts that look like customers who aren't linked yet - offered for confirmation, never linked automatically.
  let suggestions: ReturnType<typeof suggestLinks> = [];
  if (data.customers.some((c) => !c.buyerId)) {
    const profiles: { id: string; handle: string; fullName: string }[] = [];
    for (let from = 0; from < 5000; from += 1000) {
      const { data: page } = await db.from("profiles").select("id, handle, full_name").range(from, from + 999);
      for (const p of page ?? []) profiles.push({ id: p.id as string, handle: p.handle as string, fullName: (p.full_name as string | null) ?? "" });
      if (!page || page.length < 1000) break;
    }
    suggestions = suggestLinks(data.customers.map((c) => ({ id: c.id, name: c.name, buyerId: c.buyerId })), profiles);
  }

  const rows: CustomerRow[] = data.customers.map((c) => ({
    id: c.id,
    name: c.name,
    islandGroup: c.islandGroup,
    totals: data.totalsByCustomer[c.id],
    marketUnpaid: c.buyerId ? (marketUnpaidByBuyer.get(c.buyerId) ?? 0) : 0,
    lastPaymentOn: lastPaymentByCustomer.get(c.id) ?? null,
    cardsPaid: data.sales.filter((x) => x.customerId === c.id).reduce((n, x) => n + (data.paidBySale[x.id] ?? 0), 0),
  }));

  return (
    <div className="space-y-4">
      <LinkSuggestions suggestions={suggestions} />
      <CustomersView rows={rows} />
    </div>
  );
}
