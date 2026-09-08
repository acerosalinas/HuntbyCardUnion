import { LiveSalesPanel, LiveSaleClaimView, AssignableCard } from "@/components/admin/LiveSalesPanel";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/adminAuth";

interface LiveClaimJoinRow {
  id: string;
  card_id: string;
  buyer_handle: string;
  quantity: number;
  unit_price: number;
  status: string;
  claimed_at: string;
  confirmed_at: string | null;
  cards: { title: string; images: string[] } | null;
}

export default async function AdminLiveSalesPage() {
  // Not role-gated here beyond requireAdmin() - proxy.ts already redirects
  // a non-super-admin away from /admin/live-sales before this ever renders
  // (same convention as /admin/manage), and every mutation this page's
  // panel calls (findBuyerByHandle/assignLiveSale/removeLiveSale) checks
  // SUPER_ADMIN again server-side regardless.
  const admin = await requireAdmin();
  const supabase = createAdminClient();

  const [{ data: cardRows }, { data: claimRows }] = await Promise.all([
    supabase
      .from("cards")
      .select("id, title, images, price, quantity_available")
      .eq("admin_id", admin.id)
      .gt("quantity_available", 0)
      .order("title", { ascending: true }),
    supabase
      .from("card_claims")
      .select("id, card_id, buyer_handle, quantity, unit_price, status, claimed_at, confirmed_at, cards!inner(title, images, admin_id)")
      .eq("is_live_sale", true)
      .eq("cards.admin_id", admin.id)
      // Excludes CANCELLED - nothing left to track once a live-assigned
      // claim was cancelled the normal way (see cancelRelist).
      .neq("status", "CANCELLED")
      .order("claimed_at", { ascending: false }),
  ]);

  const assignableCards: AssignableCard[] = (cardRows ?? []).map((row) => ({
    id: row.id as string,
    title: row.title as string,
    image: (row.images as string[])?.[0] ?? null,
    price: row.price as number,
    quantityAvailable: row.quantity_available as number,
  }));

  const liveSales: LiveSaleClaimView[] = ((claimRows as unknown as LiveClaimJoinRow[] | null) ?? []).map((row) => ({
    id: row.id,
    cardTitle: row.cards?.title ?? "Card",
    cardImage: row.cards?.images?.[0] ?? null,
    buyerHandle: row.buyer_handle,
    quantity: row.quantity,
    unitPrice: row.unit_price,
    status: row.status === "SOLD" ? "SOLD" : "PENDING",
    claimedAt: new Date(row.claimed_at).getTime(),
  }));

  return <LiveSalesPanel cards={assignableCards} liveSales={liveSales} />;
}
