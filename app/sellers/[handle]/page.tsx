import { notFound } from "next/navigation";
import Link from "next/link";
import { ExternalLink, MessageCircle, Store } from "lucide-react";
import { SellerListingsView } from "@/components/SellerListingsView";
import { SellerReviews } from "@/components/SellerReviews";
import { SetupNotice } from "@/components/SetupNotice";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createServerReadClient } from "@/lib/supabase/server";
import {
  CardRow,
  ReviewRow,
  SellerProfileRow,
  cardFromRow,
  reviewFromRow,
  sellerProfileFromRow,
} from "@/types/marketplace";

// Same reasoning as app/marketplace/page.tsx.
export const revalidate = 15;

export async function generateMetadata({ params }: PageProps<"/sellers/[handle]">) {
  const { handle } = await params;
  if (!isSupabaseConfigured()) return { title: "Card Union" };

  const supabase = createServerReadClient();
  const { data } = await supabase.from("seller_profiles").select("display_name").eq("handle", handle).maybeSingle();
  return { title: data ? `${data.display_name} — Card Union` : "Card Union" };
}

export default async function SellerProfilePage({ params }: PageProps<"/sellers/[handle]">) {
  if (!isSupabaseConfigured()) {
    return <SetupNotice />;
  }

  const { handle } = await params;
  const supabase = createServerReadClient();
  const { data: profileRow } = await supabase.from("seller_profiles").select("*").eq("handle", handle).maybeSingle();
  if (!profileRow) notFound();

  const profile = sellerProfileFromRow(profileRow as SellerProfileRow);
  const [{ data: cardRows }, { data: reviewRows }] = await Promise.all([
    supabase.from("cards").select("*").eq("admin_id", profile.adminId).order("created_at", { ascending: false }),
    supabase.from("reviews").select("*").eq("seller_admin_id", profile.adminId).order("created_at", { ascending: false }),
  ]);
  const cards = ((cardRows as CardRow[] | null) ?? []).map(cardFromRow);
  const reviews = ((reviewRows as ReviewRow[] | null) ?? []).map(reviewFromRow);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <div className="mb-6 flex flex-col items-center gap-3 rounded-2xl border border-card-border bg-card p-6 text-center sm:flex-row sm:items-start sm:text-left">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-gold bg-navy-950 text-gold">
          {profile.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- arbitrary seller-supplied image URL
            <img src={profile.avatarUrl} alt={profile.displayName} className="h-full w-full object-cover" />
          ) : (
            <Store size={32} />
          )}
        </div>
        <div className="flex flex-1 flex-col items-center gap-2 sm:items-start">
          <h1 className="text-xl font-bold text-foreground">{profile.displayName}</h1>
          {profile.bio && <p className="max-w-2xl text-sm text-foreground-muted">{profile.bio}</p>}
          {profile.tags.length > 0 && (
            <div className="flex flex-wrap justify-center gap-1 sm:justify-start">
              {profile.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-navy-950 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gold"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
          <div className="flex items-center gap-3">
            {profile.facebookUrl && (
              <a
                href={profile.facebookUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-foreground-muted transition-colors hover:text-gold"
              >
                <ExternalLink size={16} />
                Facebook
              </a>
            )}
            {profile.instagramUrl && (
              <a
                href={profile.instagramUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-foreground-muted transition-colors hover:text-gold"
              >
                <ExternalLink size={16} />
                Instagram
              </a>
            )}
            {profile.messengerUsername && (
              <Link
                href={`https://m.me/${profile.messengerUsername}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-foreground-muted transition-colors hover:text-gold"
              >
                <MessageCircle size={18} />
                Message
              </Link>
            )}
          </div>
        </div>
      </div>

      <SellerListingsView cards={cards} liveModeSeconds={profile.liveModeSeconds} sellerTags={profile.tags} />
      <SellerReviews reviews={reviews} />
    </div>
  );
}
