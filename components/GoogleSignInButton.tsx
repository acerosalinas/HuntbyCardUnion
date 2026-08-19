"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";

export function GoogleSignInButton({ from }: { from: string }) {
  const [pending, setPending] = useState(false);

  const handleClick = async () => {
    setPending(true);
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback?from=${encodeURIComponent(from)}` },
    });
  };

  return (
    <Button type="button" variant="outline" className="w-full" onClick={handleClick} disabled={pending}>
      {pending ? "Redirecting..." : "Continue with Google"}
    </Button>
  );
}
