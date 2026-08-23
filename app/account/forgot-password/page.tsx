"use client";

import { useActionState } from "react";
import Link from "next/link";
import { KeyRound, MailCheck } from "lucide-react";
import { Logo } from "@/components/Logo";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { requestPasswordReset } from "./actions";

export default function ForgotPasswordPage() {
  const [state, formAction, pending] = useActionState<{ sent: boolean; error: string | null }, FormData>(
    requestPasswordReset,
    { sent: false, error: null },
  );

  if (state.sent) {
    return (
      <div className="mx-auto flex max-w-sm flex-col items-center gap-4 px-4 py-24">
        <div className="flex h-14 w-14 items-center justify-center rounded-full border border-gold/40 bg-navy-950 text-gold glow-gold">
          <MailCheck size={26} />
        </div>
        <h1 className="text-xl font-semibold">Check Your Email</h1>
        <p className="text-center text-sm text-foreground-muted">
          If that email has an account, we&apos;ve sent a link to reset your password.
        </p>
        <Link href="/account/login" className="text-sm text-gold hover:underline">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-4 px-4 py-24">
      <Logo src="/crdunion.png" size="lg" />
      <div className="flex h-14 w-14 items-center justify-center rounded-full border border-gold/40 bg-navy-950 text-gold glow-gold">
        <KeyRound size={26} />
      </div>
      <h1 className="text-xl font-semibold">Reset Your Password</h1>
      <p className="text-center text-sm text-foreground-muted">
        Enter your email and we&apos;ll send you a link to set a new password.
      </p>
      <form action={formAction} className="w-full space-y-3">
        <Input type="email" name="email" placeholder="you@example.com" required autoComplete="email" autoFocus />
        {state.error && <p className="text-sm text-sold">{state.error}</p>}
        <Button type="submit" variant="gold" className="w-full" disabled={pending}>
          {pending ? "Sending..." : "Send Reset Link"}
        </Button>
        <p className="text-center text-sm text-foreground-muted">
          <Link href="/account/login" className="text-gold hover:underline">
            Back to sign in
          </Link>
        </p>
      </form>
    </div>
  );
}
