import { notFound } from "next/navigation";
import { requireTrackerAdminOrRedirect } from "@/lib/tracker/auth";
import { loadTrackerData } from "@/lib/tracker/data";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadMarketplaceClaims } from "@/lib/tracker/marketplaceData";
import { CustomerDetail } from "@/components/tracker/CustomerDetail";

export const dynamic = "force-dynamic";

export default async function TrackerCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = await requireTrackerAdminOrRedirect();
  const data = await loadTrackerData(admin.id);

  // loadTrackerData is owner-scoped, so another admin's customer id is simply "not found".
  const customer = data.customers.find((c) => c.id === id);
  if (!customer) notFound();

  let linkedBuyer: { id: string; handle: string; fullName: string } | null = null;
  if (customer.buyerId) {
    const { data: profile } = await createAdminClient().from("profiles").select("id, handle, full_name").eq("id", customer.buyerId).maybeSingle();
    if (profile) linkedBuyer = { id: profile.id as string, handle: profile.handle as string, fullName: profile.full_name as string };
  }

  // Their marketplace orders on this seller's cards, so one page shows everything this person owes and is waiting on.
  const marketplace = customer.buyerId ? await loadMarketplaceClaims(createAdminClient(), admin.id, [customer.buyerId]) : [];

  return (
    <CustomerDetail
      linkedBuyer={linkedBuyer}
      marketplace={marketplace}
      pendingProofs={data.pendingProofs.filter((p) => p.customerId === id)}
      customer={customer}
      totals={data.totalsByCustomer[id]}
      lives={data.lives}
      sales={data.sales.filter((s) => s.customerId === id)}
      payments={data.payments.filter((p) => p.customerId === id)}
      shipments={data.shipments.filter((s) => s.customerId === id)}
      settings={data.settings}
      paidBySale={data.paidBySale}
      plans={data.plans.filter((p) => p.customerId === id)}
    />
  );
}
