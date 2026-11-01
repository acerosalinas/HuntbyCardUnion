import { Logo } from "@/components/Logo";
import { ContactUs } from "@/components/ContactUs";
import { Button } from "@/components/ui/Button";
import { createAuthServerClient } from "@/lib/supabase/authServer";
import { isEmailRemoved } from "@/lib/removedUsers";
import { logout } from "@/app/account/actions";

export const metadata = { title: "Waiting for approval — Card Union" };
export const dynamic = "force-dynamic";

/**
 * Where a signed-in buyer lands until an admin approves them (see proxy.ts). Approved people never see this page:
 * the proxy refreshes their session and sends them straight into the site.
 */
export default async function PendingApprovalPage() {
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
          <h1 className="text-xl font-semibold">Waiting for approval</h1>
          <p className="text-sm text-foreground-muted">
            Thanks for signing up{user?.email ? ` with ${user.email}` : ""}! Hunt by Card Union is invite-only, so an admin needs to approve your account before you can
            browse. This page will let you in as soon as that happens - check back in a little while.
          </p>
          <p className="text-sm text-foreground-muted">Want to be approved faster? Message us:</p>
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
