import "server-only";
import { createAuthServerClient } from "@/lib/supabase/authServer";

export interface CurrentBuyer {
  id: string;
  email: string;
  handle: string;
  fullName: string;
  /** Saved shipping default, editable at /account/edit - checkout pre-fills from these. */
  shipName: string | null;
  shipPhone: string | null;
  shipAddress: string | null;
  shipZip: string | null;
}

/** Resolves the signed-in buyer (email + profile) from the session cookie, or null. */
export async function getCurrentBuyer(): Promise<CurrentBuyer | null> {
  const supabase = await createAuthServerClient("buyer");
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !user.email) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("handle, full_name, ship_name, ship_phone, ship_address, ship_zip")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile) return null;

  return {
    id: user.id,
    email: user.email,
    handle: profile.handle,
    fullName: profile.full_name,
    shipName: profile.ship_name,
    shipPhone: profile.ship_phone,
    shipAddress: profile.ship_address,
    shipZip: profile.ship_zip,
  };
}
