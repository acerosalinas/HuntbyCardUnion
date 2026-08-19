"use client";

import { Suspense, useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { login } from "./actions";

function LoginForm() {
  const searchParams = useSearchParams();
  const from = searchParams.get("from") ?? "/admin";
  const [state, formAction, pending] = useActionState<{ error: string | null }, FormData>(login, {
    error: null,
  });

  return (
    <form action={formAction} className="w-full space-y-3">
      <input type="hidden" name="from" value={from} />
      <Input type="email" name="email" placeholder="you@example.com" autoFocus required autoComplete="email" />
      <Input type="password" name="password" placeholder="Password" required autoComplete="current-password" />
      {state.error && <p className="text-sm text-sold">{state.error}</p>}
      <Button type="submit" variant="gold" className="w-full" disabled={pending}>
        {pending ? "Signing in..." : "Sign In"}
      </Button>
    </form>
  );
}

export default function AdminLoginPage() {
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-4 px-4 py-24">
      <div className="flex h-14 w-14 items-center justify-center rounded-full border border-gold/40 bg-navy-950 text-gold glow-gold">
        <ShieldCheck size={26} />
      </div>
      <h1 className="text-xl font-semibold">Admin Sign In</h1>
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
