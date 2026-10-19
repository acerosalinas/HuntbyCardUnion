import { requireTrackerAdminOrRedirect } from "@/lib/tracker/auth";
import { loadTrackerData } from "@/lib/tracker/data";
import { CustomersView, CustomerRow } from "@/components/tracker/CustomersView";

export const dynamic = "force-dynamic";

export default async function TrackerCustomersPage() {
  const admin = await requireTrackerAdminOrRedirect();
  const data = await loadTrackerData(admin.id);

  const lastPaymentByCustomer = new Map<string, string>();
  for (const p of data.payments) {
    const current = lastPaymentByCustomer.get(p.customerId);
    if (!current || p.paidOn > current) lastPaymentByCustomer.set(p.customerId, p.paidOn);
  }

  const rows: CustomerRow[] = data.customers.map((c) => ({
    id: c.id,
    name: c.name,
    islandGroup: c.islandGroup,
    totals: data.totalsByCustomer[c.id],
    lastPaymentOn: lastPaymentByCustomer.get(c.id) ?? null,
  }));

  return <CustomersView rows={rows} />;
}
