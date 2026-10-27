import { requireTrackerAdminOrRedirect } from "@/lib/tracker/auth";
import { loadTrackerData } from "@/lib/tracker/data";
import { PlansView, PlanItem } from "@/components/tracker/PlansView";

export const dynamic = "force-dynamic";

export default async function TrackerPlansPage() {
  const admin = await requireTrackerAdminOrRedirect();
  const data = await loadTrackerData(admin.id);

  const customerName = new Map(data.customers.map((c) => [c.id, c.name]));
  const saleById = new Map(data.sales.map((s) => [s.id, s]));
  const liveById = new Map(data.lives.map((l) => [l.id, l]));

  const items: PlanItem[] = data.plans
    .map((p) => {
      const sale = saleById.get(p.saleId);
      if (!sale) return null;
      return {
        id: p.id,
        status: p.status as "REQUESTED" | "ACTIVE",
        requestedBy: p.requestedBy,
        customerId: p.customerId,
        customerName: customerName.get(p.customerId) ?? "Customer",
        saleId: sale.id,
        cardName: sale.cardName,
        liveTitle: liveById.get(sale.liveId)?.title ?? "",
        amount: sale.amount,
        paid: data.paidBySale[sale.id] ?? 0,
        note: p.note,
        createdAt: p.createdAt,
        installments: p.installments,
      } satisfies PlanItem;
    })
    .filter((i): i is PlanItem => i !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return <PlansView items={items} />;
}
