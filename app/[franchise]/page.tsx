import { notFound } from "next/navigation";
import { Marketplace } from "@/components/Marketplace";
import { SetupNotice } from "@/components/SetupNotice";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createServerReadClient } from "@/lib/supabase/server";
import { getFranchiseBySlug } from "@/lib/franchises";
import { CardRow, cardFromRow } from "@/types/marketplace";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/[franchise]">) {
  const { franchise } = await params;
  const known = getFranchiseBySlug(franchise);
  return { title: known ? `${known.label} — Card Union` : "Card Union" };
}

export default async function FranchisePage({ params }: PageProps<"/[franchise]">) {
  const { franchise: slug } = await params;
  const franchise = getFranchiseBySlug(slug);
  if (!franchise) notFound();

  if (!isSupabaseConfigured()) {
    return <SetupNotice />;
  }

  const supabase = createServerReadClient();
  const { data } = await supabase
    .from("cards")
    .select("*")
    .ilike("franchise", franchise.slug)
    .order("created_at", { ascending: false });

  const initialCards = ((data as CardRow[] | null) ?? []).map(cardFromRow);

  const nextDropAtRaw = process.env.NEXT_PUBLIC_NEXT_DROP_AT;
  const nextDropAt = nextDropAtRaw ? new Date(nextDropAtRaw).getTime() : null;

  return (
    <Marketplace
      initialCards={initialCards}
      nextDropAt={nextDropAt}
      franchiseSlug={franchise.slug}
      franchiseLabel={franchise.label}
    />
  );
}
