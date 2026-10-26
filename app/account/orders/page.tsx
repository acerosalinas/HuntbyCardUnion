import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { LiveOrders } from "@/components/account/LiveOrders";
import { getCurrentBuyer } from "@/lib/buyerAuth";
import { loadPortalForBuyer } from "@/lib/tracker/portal";

export const dynamic = "force-dynamic";

/** The signed-in buyer's own live orders. Shows only tracker customers LINKED to this account; the buyer id comes from the session, never the URL. */
export default async function MyLiveOrdersPage() {
  const buyer = await getCurrentBuyer();
  if (!buyer) redirect("/account/login?from=%2Faccount%2Forders");

  const customers = await loadPortalForBuyer(buyer.id);

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-4 py-24">
      <div className="flex items-center gap-3">
        <Link href="/account" aria-label="Back to my account" className="rounded-full p-1.5 text-foreground-muted hover:bg-foreground/10">
          <ArrowLeft size={18} />
        </Link>
        <h1 className="text-xl font-semibold">My Live Orders</h1>
      </div>

      {customers.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-card-border p-8 text-center text-sm text-foreground-muted">
          <p className="mb-1">Your live orders aren&apos;t linked to this account yet.</p>
          <p>
            Send the seller your handle <span className="font-semibold text-foreground">@{buyer.handle}</span> and they&apos;ll link it, then your cards and balance will show up here.
          </p>
        </div>
      ) : (
        customers.map((c) => <LiveOrders key={c.customerId} customer={c} />)
      )}
    </div>
  );
}
