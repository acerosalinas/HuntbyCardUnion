import "server-only";
import { createAuthServerClient } from "@/lib/supabase/authServer";

export interface CurrentBuyer {
  id: string;
  email: string;
  handle: string;
  fullName: string;
}

/** Resolves the signed-in buyer (email + profile) from the session cookie, or null. */
export async function getCurrentBuyer(): Promise<CurrentBuyer | null> {
  const supabase = await createAuthServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !user.email) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("handle, full_name")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile) return null;

  return { id: user.id, email: user.email, handle: profile.handle, fullName: profile.full_name };
}
