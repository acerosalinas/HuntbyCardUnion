import { redirect } from "next/navigation";
import { createAuthServerClient } from "@/lib/supabase/authServer";
import { CompleteProfileForm } from "./CompleteProfileForm";

export default async function CompleteProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from = "/" } = await searchParams;
  const supabase = await createAuthServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/account/login?from=${encodeURIComponent(from)}`);
  }

  const { data: profile } = await supabase.from("profiles").select("id").eq("id", user.id).maybeSingle();
  if (profile) {
    redirect(from.startsWith("/admin") ? "/" : from);
  }

  const suggestedName =
    (user.user_metadata?.full_name as string | undefined) ?? (user.user_metadata?.name as string | undefined) ?? "";

  return <CompleteProfileForm from={from} suggestedName={suggestedName} />;
}
