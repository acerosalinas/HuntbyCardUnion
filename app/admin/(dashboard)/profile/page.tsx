import { SellerProfileForm } from "@/components/admin/SellerProfileForm";
import { getMySellerProfile } from "@/app/admin/actions";

export default async function AdminProfilePage() {
  const profile = await getMySellerProfile();

  return (
    <div className="space-y-4">
      <p className="text-sm text-foreground-muted">
        This is your public Seller Spotlight — buyers see it on the home page, on{" "}
        <span className="text-foreground">/sellers</span>, and as the &quot;Card Owner&quot; on your listings.
      </p>
      <SellerProfileForm profile={profile} />
    </div>
  );
}
