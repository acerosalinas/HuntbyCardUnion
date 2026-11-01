import { requireTrackerAdminOrRedirect } from "@/lib/tracker/auth";
import { loadTrackerData } from "@/lib/tracker/data";
import { PlansView, PlanItem } from "@/components/tracker/PlansView";
import { InstallmentLog, LogItem } from "@/components/tracker/InstallmentLog";
import type { TrackerPayment } from "@/lib/tracker/data";
import { summarizeCardPayments } from "@/lib/tracker/installmentLog";

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

  // The log of cards paid in parts (see lib/tracker/installmentLog.ts for what counts as "in parts").
  const cardPayments = data.payments.filter((p) => p.purpose === "CARDS");
  const planBySale = new Map(data.plans.map((p) => [p.saleId, p.status as "ACTIVE" | "REQUESTED"]));
  const summaries = new Map(summarizeCardPayments(data.sales, data.payments, data.paidBySale).map((x) => [x.saleId, x]));

  const partial: LogItem[] = [];
  const completed: LogItem[] = [];
  for (const sale of data.sales) {
    const sum = summaries.get(sale.id);
    if (!sum) continue;
    const item: LogItem = {
      saleId: sale.id,
      customerId: sale.customerId,
      customerName: customerName.get(sale.customerId) ?? "Customer",
      cardName: sale.cardName,
      liveId: sale.liveId,
      liveTitle: liveById.get(sale.liveId)?.title ?? "",
      amount: sale.amount,
      paid: sum.paid,
      lastPaidOn: sum.lastPaidOn,
      paymentCount: sum.paymentCount,
      planStatus: planBySale.get(sale.id) ?? null,
    };
    if (sum.left > 0) partial.push(item);
    else if (sum.parts >= 2) completed.push(item);
  }
  // Longest since the last payment first, so the cards to chase are at the top.
  partial.sort((a, b) => (a.lastPaidOn ?? "").localeCompare(b.lastPaidOn ?? ""));
  completed.sort((a, b) => (b.lastPaidOn ?? "").localeCompare(a.lastPaidOn ?? ""));
  const recent = completed.slice(0, 10);

  const paymentsByCustomer: Record<string, TrackerPayment[]> = {};
  for (const item of [...partial, ...recent]) {
    paymentsByCustomer[item.customerId] ??= cardPayments.filter((p) => p.customerId === item.customerId);
  }

  return (
    <PlansView items={items}>
      <InstallmentLog partial={partial} completed={recent} paymentsByCustomer={paymentsByCustomer} />
    </PlansView>
  );
}
