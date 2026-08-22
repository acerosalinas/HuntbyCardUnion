import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { SellerProfileForm } from "@/components/admin/SellerProfileForm";
import { getMySellerProfile } from "@/app/admin/actions";

export default async function AdminProfilePage() {
  const profile = await getMySellerProfile();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-foreground-muted">
          This is your public Seller Spotlight — buyers see it on the home page, on{" "}
          <span className="text-foreground">/sellers</span>, and as the &quot;Card Owner&quot; on your listings.
        </p>
        {profile?.handle && (
          <Link
            href={`/sellers/${profile.handle}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-card-border px-3 py-1.5 text-xs font-medium text-foreground-muted transition-colors hover:border-gold/40 hover:text-gold"
          >
            Preview Storefront
            <ExternalLink size={12} />
          </Link>
        )}
      </div>
      <SellerProfileForm profile={profile} />
    </div>
  );
}
