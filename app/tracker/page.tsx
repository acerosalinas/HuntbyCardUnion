import { requireTrackerAdminOrRedirect } from "@/lib/tracker/auth";
import { loadTrackerData } from "@/lib/tracker/data";
import { EntryView } from "@/components/tracker/EntryView";

export const dynamic = "force-dynamic";

export default async function TrackerEntryPage({ searchParams }: { searchParams: Promise<{ live?: string }> }) {
  const admin = await requireTrackerAdminOrRedirect();
  const { live } = await searchParams;
  const data = await loadTrackerData(admin.id);

  // Default to the most recent live (lives are loaded newest-first).
  const liveId = data.lives.some((l) => l.id === live) ? live! : (data.lives[0]?.id ?? null);

  return (
    <EntryView
      liveId={liveId}
      lives={data.lives}
      customers={data.customers}
      sales={data.sales.filter((s) => s.liveId === liveId)}
      totalsByCustomer={data.totalsByCustomer}
      settings={data.settings}
      payments={data.payments}
      liveBreakdown={data.liveBreakdown}
    />
  );
}
