import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { SoldOutListingsView } from "@/components/SoldOutListingsView";
import { SetupNotice } from "@/components/SetupNotice";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createServerReadClient } from "@/lib/supabase/server";
import { CardRow, SellerProfileRow, cardFromRow, sellerProfileFromRow } from "@/types/marketplace";

// Same reasoning as app/sellers/[handle]/page.tsx.
export const revalidate = 15;

export async function generateMetadata({ params }: PageProps<"/sellers/[handle]/sold-out">) {
  const { handle } = await params;
  if (!isSupabaseConfigured()) return { title: "Card Union" };

  const supabase = createServerReadClient();
  const { data } = await supabase.from("seller_profiles").select("display_name").eq("handle", handle).maybeSingle();
  return { title: data ? `Sold Out — ${data.display_name} — Card Union` : "Card Union" };
}

export default async function SellerSoldOutPage({ params }: PageProps<"/sellers/[handle]/sold-out">) {
  if (!isSupabaseConfigured()) {
    return <SetupNotice />;
  }

  const { handle } = await params;
  const supabase = createServerReadClient();
  const { data: profileRow } = await supabase.from("seller_profiles").select("*").eq("handle", handle).maybeSingle();
  if (!profileRow) notFound();

  const profile = sellerProfileFromRow(profileRow as SellerProfileRow);
  const { data: cardRows } = await supabase
    .from("cards")
    .select("*")
    .eq("admin_id", profile.adminId)
    .eq("status", "SOLD")
    .order("created_at", { ascending: false });
  const cards = ((cardRows as CardRow[] | null) ?? []).map(cardFromRow);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <div className="mb-4 flex items-center justify-between gap-2">
        <Link
          href={`/sellers/${handle}`}
          className="inline-flex items-center gap-1.5 text-sm text-foreground-muted transition-colors hover:text-foreground"
        >
          <ArrowLeft size={16} />
          {profile.displayName}
        </Link>
        <h1 className="text-lg font-bold text-foreground">Sold Out</h1>
      </div>
      <SoldOutListingsView cards={cards} handle={handle} />
    </div>
  );
}
