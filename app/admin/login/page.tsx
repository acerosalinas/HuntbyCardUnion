import { redirect } from "next/navigation";

/**
 * /admin/login used to be a separate sign-in form - admins now use the one
 * shared page at /account/login (see app/account/login/actions.ts), which
 * detects an admin account after authenticating and routes accordingly.
 * This stub only ever renders for an already-authenticated admin (anyone
 * else gets redirected to /account/login by proxy.ts before reaching here)
 * revisiting an old bookmark, so it just sends them on to the dashboard.
 */
export default function AdminLoginRedirect() {
  redirect("/admin");
}
