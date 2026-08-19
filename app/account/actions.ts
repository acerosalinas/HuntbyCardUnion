"use server";

import { redirect } from "next/navigation";
import { createAuthServerClient } from "@/lib/supabase/authServer";

export async function logout() {
  const supabase = await createAuthServerClient("buyer");
  await supabase.auth.signOut();
  redirect("/");
}
