"use client";

import { Suspense, useActionState, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Logo } from "@/components/Logo";
import { Input } from "@/components/ui/Input";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { Button } from "@/components/ui/Button";
import { RemovedAccessModal } from "@/components/RemovedAccessModal";
// import { GoogleSignInButton } from "@/components/GoogleSignInButton"; // temporarily disabled
import { cleanHandleInput, HANDLE_HINT, HANDLE_MAX_LENGTH } from "@/lib/handleFormat";
import { signup, SignupState } from "./actions";

function SignupForm() {
  const searchParams = useSearchParams();
  const from = searchParams.get("from") ?? "/";
  const [state, formAction, pending] = useActionState<SignupState, FormData>(signup, { error: null });
  // The handle only ever holds what a handle can hold, so a space or dot typed on a phone can't sneak in.
  const [handle, setHandle] = useState("");
  // Closing the pop-up is remembered per answer, so the next attempt can show it again.
  const [closedFor, setClosedFor] = useState<object | null>(null);

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
        {/* A failed attempt hands back what was typed (React would otherwise empty every box); the password is never sent back. */}
        <Input name="fullName" placeholder="Full name" required autoComplete="name" defaultValue={state.values?.fullName} key={`n${state.values?.fullName ?? ""}`} aria-invalid={state.field === "fullName"} />
        {state.field === "fullName" && <p className="text-sm text-sold">{state.error}</p>}
        <Input type="email" name="email" placeholder="you@example.com" required autoComplete="email" defaultValue={state.values?.email} key={`e${state.values?.email ?? ""}`} aria-invalid={state.field === "email"} />
        {state.field === "email" && <p className="text-sm text-sold">{state.error}</p>}
        <div>
          <Input
            name="handle"
            placeholder="@yourhandle"
            required
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={HANDLE_MAX_LENGTH + 1} // + the leading @
            value={handle ? `@${handle}` : ""}
            onChange={(e) => setHandle(cleanHandleInput(e.target.value))}
            aria-invalid={state.field === "handle"}
            aria-describedby="handle-help"
          />
          <p id="handle-help" className={state.field === "handle" ? "mt-1 text-sm text-sold" : "mt-1 text-xs text-foreground-muted"}>
            {state.field === "handle" ? state.error : HANDLE_HINT}
          </p>
        </div>
        <PasswordInput
          name="password"
          placeholder="Password (min. 8 characters)"
          required
          minLength={8}
          autoComplete="new-password"
          aria-invalid={state.field === "password"}
        />
        {state.field === "password" && <p className="text-sm text-sold">{state.error}</p>}
        <RemovedAccessModal open={Boolean(state.removed) && closedFor !== state} onClose={() => setClosedFor(state)} />
        {state.error && !state.field && <p className="text-sm text-sold">{state.error}</p>}
        <Button type="submit" variant="gold" className="w-full" disabled={pending}>
          {pending ? "Creating account..." : "Create Account"}
        </Button>
        <p className="text-center text-sm text-foreground-muted">
          Already have an account?{" "}
          <Link href={`/account/login?from=${encodeURIComponent(from)}`} className="font-medium text-gold-ink hover:underline">
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
