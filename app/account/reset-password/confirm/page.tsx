"use client";

import { useActionState } from "react";
import { KeyRound } from "lucide-react";
import { Logo } from "@/components/Logo";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { confirmPasswordReset } from "./actions";

export default function ResetPasswordConfirmPage() {
  const [state, formAction, pending] = useActionState<{ error: string | null }, FormData>(confirmPasswordReset, {
    error: null,
  });

  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-4 px-4 py-24">
      <Logo src="/crdunion.png" size="lg" />
      <div className="flex h-14 w-14 items-center justify-center rounded-full border border-gold/40 bg-navy-950 text-gold glow-gold">
        <KeyRound size={26} />
      </div>
      <h1 className="text-xl font-semibold">Set a New Password</h1>
      <form action={formAction} className="w-full space-y-3">
        <Input
          type="password"
          name="password"
          placeholder="New password"
          required
          autoComplete="new-password"
          autoFocus
        />
        <Input
          type="password"
          name="confirmPassword"
          placeholder="Confirm new password"
          required
          autoComplete="new-password"
        />
        {state.error && <p className="text-sm text-sold">{state.error}</p>}
        <Button type="submit" variant="gold" className="w-full" disabled={pending}>
          {pending ? "Saving..." : "Save New Password"}
        </Button>
      </form>
    </div>
  );
}
