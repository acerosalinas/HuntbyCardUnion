import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { EditProfileForm } from "@/components/EditProfileForm";
import { getCurrentBuyer } from "@/lib/buyerAuth";

export const dynamic = "force-dynamic";

export default async function EditAccountPage() {
  const buyer = await getCurrentBuyer();
  if (!buyer) {
    redirect("/account/login?from=%2Faccount%2Fedit");
  }

  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-4 px-4 py-16">
      <Link
        href="/account"
        className="mr-auto inline-flex items-center gap-1.5 text-sm text-foreground-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft size={16} />
        Back to Account
      </Link>
      <h1 className="text-xl font-semibold">Edit Profile</h1>
      <EditProfileForm buyer={buyer} />
    </div>
  );
}
