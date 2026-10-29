import { WantedCardsView } from "@/components/admin/WantedCardsView";
import { WishlistedCardsView, WishlistedItem } from "@/components/admin/WishlistedCardsView";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/adminAuth";
import { WantedCardRow, wantedCardFromRow } from "@/types/marketplace";

export default async function AdminWantedPage() {
  const admin = await requireAdmin();
  const supabase = createAdminClient();

  // Not scoped per-admin (unlike Inventory/Offers/Sales Log) - a buyer's
  // "can't find it" request isn't owned by any one seller, every admin
  // should see the same shared want-list.
  const { data } = await supabase.from("wanted_cards").select("*").order("created_at", { ascending: false });
  const wanted = ((data as WantedCardRow[] | null) ?? []).map(wantedCardFromRow);

  // Hearted listings ARE tied to a seller (the card's owner), so an admin sees the ones on their own
  // listings and a super admin sees all, the same scoping as Inventory.
  let wishlistQuery = supabase
    .from("wishlists")
    .select("id, buyer_id, card_id, status, created_at, cards!inner(title, images, list_price, status, admin_id)")
    .order("created_at", { ascending: false })
    .limit(300);
  if (admin.role !== "SUPER_ADMIN") wishlistQuery = wishlistQuery.eq("cards.admin_id", admin.id);
  const { data: wishRows, error: wishError } = await wishlistQuery;

  let items: WishlistedItem[] = [];
  let wishlistNote: string | null = null;
  if (wishError) {
    // The status column arrives with migration_wishlist_admin.sql.
    wishlistNote = /status|schema cache|does not exist/i.test(wishError.message)
      ? "Wishlisted cards will show here once supabase/migration_wishlist_admin.sql has been run."
      : wishError.message;
  } else {
    const rows = (wishRows ?? []) as unknown as {
      id: string;
      buyer_id: string;
      card_id: string;
      status: "OPEN" | "FULFILLED" | "CLOSED";
      created_at: string;
      cards: { title: string; images: string[] | null; list_price: number; status: string } | { title: string; images: string[] | null; list_price: number; status: string }[];
    }[];
    const buyerIds = [...new Set(rows.map((r) => r.buyer_id))];
    const { data: profiles } = buyerIds.length ? await supabase.from("profiles").select("id, handle").in("id", buyerIds) : { data: [] as { id: string; handle: string }[] };
    const handleById = new Map((profiles ?? []).map((p) => [p.id as string, p.handle as string]));
    items = rows.map((r) => {
      const card = Array.isArray(r.cards) ? r.cards[0] : r.cards;
      return {
        id: r.id,
        cardId: r.card_id,
        cardTitle: card?.title ?? "Card",
        images: card?.images ?? [],
        price: Number(card?.list_price ?? 0),
        cardStatus: card?.status ?? "",
        buyerHandle: handleById.get(r.buyer_id) ?? "buyer",
        createdAt: r.created_at,
        status: r.status,
      };
    });
  }

  return (
    <>
      <WantedCardsView wanted={wanted} />
      {wishlistNote ? <p className="mt-8 rounded-2xl border border-dashed border-card-border p-6 text-center text-sm text-foreground-muted">{wishlistNote}</p> : <WishlistedCardsView items={items} />}
    </>
  );
}
