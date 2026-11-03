import { Logo } from "@/components/Logo";
import { ContactUs } from "@/components/ContactUs";
import { Button } from "@/components/ui/Button";
import { createAuthServerClient } from "@/lib/supabase/authServer";
import { isEmailRemoved } from "@/lib/removedUsers";
import { logout } from "@/app/account/actions";

export const metadata = { title: "Account on hold — Card Union" };
export const dynamic = "force-dynamic";

/**
 * Where a signed-in buyer lands while an admin has their account on hold (see proxy.ts). Everyone else never sees this
 * page: once a hold is lifted the proxy refreshes the session and sends them straight into the site.
 */
export default async function AccountOnHoldPage() {
  const supabase = await createAuthServerClient("buyer");
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const removed = user?.email ? await isEmailRemoved(user.email) : false;

  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-4 px-4 py-24 text-center">
      <Logo src="/crdunion.png" size="lg" />
      {removed ? (
        <>
          <h1 className="text-xl font-semibold">Account removed</h1>
          <p className="text-sm text-foreground-muted">This account was removed, so it can&apos;t be used. If you&apos;d like access again, please message us:</p>
          <div className="w-full text-left">
            <ContactUs />
          </div>
        </>
      ) : (
        <>
          <h1 className="text-xl font-semibold">Your account is on hold</h1>
          <p className="text-sm text-foreground-muted">
            {user?.email ? `The account ${user.email}` : "This account"} has been put on hold, so you can&apos;t browse or buy for now. If you think this is a mistake, or you&apos;d like
            it looked at, please message us:
          </p>
          <div className="w-full text-left">
            <ContactUs />
          </div>
        </>
      )}
      <form action={logout} className="pt-2">
        <Button type="submit" variant="outline">
          Sign out
        </Button>
      </form>
    </div>
  );
}
