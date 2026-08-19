"use server";

import { redirect } from "next/navigation";
import { createAuthServerClient } from "@/lib/supabase/authServer";

export async function login(_prevState: { error: string | null }, formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const from = String(formData.get("from") ?? "/admin");

  if (!email || !password) {
    return { error: "Enter your email and password." };
  }

  const supabase = await createAuthServerClient("admin");
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: "Incorrect email or password." };
  }

  redirect(from.startsWith("/admin") ? from : "/admin");
}
