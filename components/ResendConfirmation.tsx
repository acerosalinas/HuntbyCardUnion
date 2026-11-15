"use client";

import { useState, useTransition } from "react";
import { Input } from "@/components/ui/Input";
import { resendConfirmation } from "@/app/account/signup/actions";

/** "Didn't get the email?" - sends the confirmation link again. Asks for the address when it isn't known yet. */
export function ResendConfirmation({ email: known = "", from = "/" }: { email?: string; from?: string }) {
  const [email, setEmail] = useState(known);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const send = () =>
    startTransition(async () => {
      setMessage(null);
      const result = await resendConfirmation(email, from);
      setMessage(result.error ? { text: result.error, ok: false } : { text: "Sent. Check your inbox and your spam or junk folder - it can take a minute or two.", ok: true });
    });

  return (
    <div className="w-full space-y-2 rounded-xl border border-card-border bg-card p-3 text-sm">
      <p className="font-medium text-foreground">Didn&apos;t get the email?</p>
      <p className="text-xs text-foreground-muted">Look in spam or junk first, then send the link again.</p>
      {!known && <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" aria-label="Your email address" />}
      <button
        type="button"
        onClick={send}
        disabled={pending || !email.trim()}
        className="rounded-lg border border-gold/50 px-3 py-1.5 text-xs font-medium text-gold-ink transition-colors hover:bg-gold/10 disabled:opacity-50"
      >
        {pending ? "Sending..." : "Resend confirmation email"}
      </button>
      {message && (
        <p role="status" className={message.ok ? "text-xs text-available" : "text-xs text-sold"}>
          {message.text}
        </p>
      )}
    </div>
  );
}
