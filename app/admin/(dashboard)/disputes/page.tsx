import { DisputesTable, DisputeRowView } from "@/components/admin/DisputesTable";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/adminAuth";
import { DisputeStatus } from "@/types/marketplace";

interface DisputeJoinRow {
  id: string;
  card_id: string;
  reason: string;
  status: DisputeStatus;
  seller_admin_id: string | null;
  created_at: string;
  cards: { title: string; admin_id: string | null } | null;
}

const STATUS_FILTERS: { value: DisputeStatus | "ALL"; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "OPEN", label: "Open" },
  { value: "SELLER_RESPONDED", label: "Seller Responded" },
  { value: "UNDER_REVIEW", label: "Under Review" },
  { value: "RESOLVED_REFUND", label: "Resolved - Refund" },
  { value: "RESOLVED_DISMISSED", label: "Resolved - Dismissed" },
];

export default async function AdminDisputesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const admin = await requireAdmin();
  const { status } = await searchParams;
  const activeStatus = STATUS_FILTERS.some((f) => f.value === status) ? (status as DisputeStatus | "ALL") : "ALL";

  const supabase = createAdminClient();

  let query = supabase
    .from("disputes")
    .select("id, card_id, reason, status, seller_admin_id, created_at, cards!inner(title, admin_id)")
    .order("created_at", { ascending: false });

  if (admin.role !== "SUPER_ADMIN") {
    query = query.eq("seller_admin_id", admin.id);
  }
  if (activeStatus !== "ALL") {
    query = query.eq("status", activeStatus);
  }

  const { data } = await query.returns<DisputeJoinRow[]>();

  const disputes: DisputeRowView[] = (data ?? []).map((row) => ({
    id: row.id,
    cardTitle: row.cards?.title ?? "Unknown card",
    reason: row.reason as DisputeRowView["reason"],
    status: row.status,
    createdAt: new Date(row.created_at).getTime(),
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((f) => (
          <a
            key={f.value}
            href={f.value === "ALL" ? "/admin/disputes" : `/admin/disputes?status=${f.value}`}
            className={
              activeStatus === f.value
                ? "rounded-full bg-gold px-3 py-1 text-xs font-semibold text-navy-950"
                : "rounded-full border border-card-border px-3 py-1 text-xs font-medium text-foreground-muted hover:text-foreground"
            }
          >
            {f.label}
          </a>
        ))}
      </div>
      <DisputesTable disputes={disputes} />
    </div>
  );
}
