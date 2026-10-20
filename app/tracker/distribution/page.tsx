import { requireTrackerAdminOrRedirect } from "@/lib/tracker/auth";
import { loadTrackerData } from "@/lib/tracker/data";
import { DistributionView } from "@/components/tracker/DistributionView";

export const dynamic = "force-dynamic";

export default async function TrackerDistributionPage() {
  const admin = await requireTrackerAdminOrRedirect();
  const data = await loadTrackerData(admin.id);
  return (
    <DistributionView
      customers={data.customers}
      lives={data.lives}
      sales={data.sales}
      shipments={data.shipments}
      totalsByCustomer={data.totalsByCustomer}
      settings={data.settings}
    />
  );
}
