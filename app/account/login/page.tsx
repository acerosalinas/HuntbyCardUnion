"use client";

import { Suspense, useActionState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Logo } from "@/components/Logo";
import { Input } from "@/components/ui/Input";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { Button } from "@/components/ui/Button";
// import { GoogleSignInButton } from "@/components/GoogleSignInButton"; // temporarily disabled
import { login } from "./actions";

function LoginForm() {
  const searchParams = useSearchParams();
  const from = searchParams.get("from") ?? "/";
  const [state, formAction, pending] = useActionState<{ error: string | null }, FormData>(login, {
    error: null,
  });

  return (
    <div className="w-full space-y-3">
      {/* Google sign-in temporarily disabled - re-enable by uncommenting this and the import above */}
      {/* <GoogleSignInButton from={from} />
      <div className="flex items-center gap-3 text-xs text-foreground-muted">
        <span className="h-px flex-1 bg-card-border" />
        or
        <span className="h-px flex-1 bg-card-border" />
      </div> */}
      {searchParams.get("reset") === "success" && (
        <p className="w-full rounded-lg bg-available/10 px-3 py-2 text-center text-sm text-available">
          Password updated - sign in with your new password.
        </p>
      )}
      <form action={formAction} className="w-full space-y-3">
        <input type="hidden" name="from" value={from} />
        <Input type="email" name="email" placeholder="you@example.com" required autoComplete="email" />
        <PasswordInput name="password" placeholder="Password" required autoComplete="current-password" />
        <div className="flex justify-end">
          <Link href="/account/forgot-password" className="text-xs text-foreground-muted hover:text-gold hover:underline">
            Forgot password?
          </Link>
        </div>
        {state.error && <p className="text-sm text-sold">{state.error}</p>}
        <Button type="submit" variant="gold" className="w-full" disabled={pending}>
          {pending ? "Signing in..." : "Sign In"}
        </Button>
        <p className="text-center text-sm text-foreground-muted">
          Don&apos;t have an account?{" "}
          <Link href={`/account/signup?from=${encodeURIComponent(from)}`} className="text-gold hover:underline">
            Sign up
          </Link>
        </p>
      </form>
      <p className="text-center text-xs text-foreground-muted">
        Sellers and admins sign in here too - we&apos;ll send you to the right dashboard automatically.
      </p>
    </div>
  );
}

export default function BuyerLoginPage() {
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-4 px-4 py-24">
      <Logo src="/crdunion.png" size="lg" />
      <h1 className="text-xl font-semibold">Sign In</h1>
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
