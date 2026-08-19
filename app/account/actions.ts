"use server";

import { redirect } from "next/navigation";
import { createAuthServerClient } from "@/lib/supabase/authServer";

export async function logout() {
  const supabase = await createAuthServerClient("buyer");
  await supabase.auth.signOut();
  // Not "/" - the whole site requires a session (see proxy.ts), so that would
  // just bounce straight back through middleware to this same destination
  // one extra hop later.
  redirect("/account/login");
}
