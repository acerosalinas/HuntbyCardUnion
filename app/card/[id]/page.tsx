import { notFound } from "next/navigation";
import { CardDetail } from "@/components/CardDetail";
import { SetupNotice } from "@/components/SetupNotice";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createServerReadClient } from "@/lib/supabase/server";
import { CardRow, SellerProfileRow, cardFromRow, sellerProfileFromRow } from "@/types/marketplace";

// Same reasoning as app/marketplace/page.tsx.
export const revalidate = 15;

export async function generateMetadata({ params }: PageProps<"/card/[id]">) {
  const { id } = await params;
  if (!isSupabaseConfigured()) return { title: "Card Union" };

  const supabase = createServerReadClient();
  const { data } = await supabase.from("cards").select("title").eq("id", id).maybeSingle();
  return { title: data ? `${data.title} — Card Union` : "Card Union" };
}

export default async function CardDetailPage({ params }: PageProps<"/card/[id]">) {
  if (!isSupabaseConfigured()) {
    return <SetupNotice />;
  }

  const { id } = await params;
  const supabase = createServerReadClient();
  const { data } = await supabase.from("cards").select("*").eq("id", id).maybeSingle();

  if (!data) {
    notFound();
  }

  const card = cardFromRow(data as CardRow);
  let sellerProfile = null;
  if (card.adminId) {
    const { data: profileRow } = await supabase
      .from("seller_profiles")
      .select("*")
      .eq("admin_id", card.adminId)
      .maybeSingle();
    if (profileRow) sellerProfile = sellerProfileFromRow(profileRow as SellerProfileRow);
  }

  return <CardDetail initialCard={card} initialSellerProfile={sellerProfile} />;
}
