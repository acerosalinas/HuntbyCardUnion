"use client";

import { Suspense, useActionState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Logo } from "@/components/Logo";
import { Input } from "@/components/ui/Input";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { Button } from "@/components/ui/Button";
// import { GoogleSignInButton } from "@/components/GoogleSignInButton"; // temporarily disabled
import { signup } from "./actions";

function SignupForm() {
  const searchParams = useSearchParams();
  const from = searchParams.get("from") ?? "/";
  const [state, formAction, pending] = useActionState<{ error: string | null }, FormData>(signup, {
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
      <form action={formAction} className="w-full space-y-3">
        <input type="hidden" name="from" value={from} />
        <Input name="fullName" placeholder="Full name" required autoComplete="name" />
        <Input type="email" name="email" placeholder="you@example.com" required autoComplete="email" />
        <Input name="handle" placeholder="@yourhandle" required autoComplete="off" />
        <PasswordInput
          name="password"
          placeholder="Password (min. 8 characters)"
          required
          minLength={8}
          autoComplete="new-password"
        />
        {state.error && <p className="text-sm text-sold">{state.error}</p>}
        <Button type="submit" variant="gold" className="w-full" disabled={pending}>
          {pending ? "Creating account..." : "Create Account"}
        </Button>
        <p className="text-center text-sm text-foreground-muted">
          Already have an account?{" "}
          <Link href={`/account/login?from=${encodeURIComponent(from)}`} className="text-gold hover:underline">
            Sign in
          </Link>
        </p>
      </form>
    </div>
  );
}

export default function SignupPage() {
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-4 px-4 py-24">
      <Logo src="/crdunion.png" size="lg" />
      <h1 className="text-xl font-semibold">Create Your Account</h1>
      <p className="text-center text-sm text-foreground-muted">
        Used to identify your dibs, offers, and orders to the seller and admin.
      </p>
      <Suspense>
        <SignupForm />
      </Suspense>
    </div>
  );
}
