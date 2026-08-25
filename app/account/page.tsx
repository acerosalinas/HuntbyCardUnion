import { redirect } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, Heart, PackageSearch, Settings, UserCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { getCurrentBuyer } from "@/lib/buyerAuth";
import { logout } from "./actions";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const buyer = await getCurrentBuyer();
  if (!buyer) {
    redirect("/account/login?from=%2Faccount");
  }

  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-4 px-4 py-24">
      <div className="flex h-14 w-14 items-center justify-center rounded-full border border-gold/40 bg-navy-950 text-gold glow-gold">
        <UserCircle size={26} />
      </div>
      <h1 className="text-xl font-semibold">{buyer.handle}</h1>
      <div className="w-full space-y-1 rounded-2xl border border-card-border bg-card p-4 text-sm">
        <p className="text-foreground-muted">
          Name: <span className="text-foreground">{buyer.fullName}</span>
        </p>
        <p className="text-foreground-muted">
          Email: <span className="text-foreground">{buyer.email}</span>
        </p>
      </div>
      <Link href="/account/edit" className="w-full">
        <Button variant="outline" className="w-full">
          <Settings size={14} />
          Edit Profile
        </Button>
      </Link>
      <Link href="/account/dibs" className="w-full">
        <Button variant="outline" className="w-full">
          <PackageSearch size={14} />
          My Dibs
        </Button>
      </Link>
      <Link href="/account/wishlist" className="w-full">
        <Button variant="outline" className="w-full">
          <Heart size={14} />
          My Wishlist
        </Button>
      </Link>
      <Link href="/account/disputes" className="w-full">
        <Button variant="outline" className="w-full">
          <AlertTriangle size={14} />
          My Disputes
        </Button>
      </Link>
      <form action={logout} className="w-full">
        <Button type="submit" variant="outline" className="w-full">
          Log Out
        </Button>
      </form>
    </div>
  );
}
