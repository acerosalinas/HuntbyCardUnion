"use client";

import { useActionState } from "react";
import { UserPlus } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { completeProfile } from "./actions";

export function CompleteProfileForm({ from, suggestedName }: { from: string; suggestedName: string }) {
  const [state, formAction, pending] = useActionState<{ error: string | null }, FormData>(completeProfile, {
    error: null,
  });

  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-4 px-4 py-24">
      <div className="flex h-14 w-14 items-center justify-center rounded-full border border-gold/40 bg-navy-950 text-gold glow-gold">
        <UserPlus size={26} />
      </div>
      <h1 className="text-xl font-semibold">One More Step</h1>
      <p className="text-center text-sm text-foreground-muted">
        Choose a handle so sellers and admin can identify your dibs, offers, and orders.
      </p>
      <form action={formAction} className="w-full space-y-3">
        <input type="hidden" name="from" value={from} />
        <Input name="fullName" placeholder="Full name" defaultValue={suggestedName} autoFocus required autoComplete="name" />
        <Input name="handle" placeholder="@yourhandle" required autoComplete="off" />
        {state.error && <p className="text-sm text-sold">{state.error}</p>}
        <Button type="submit" variant="gold" className="w-full" disabled={pending}>
          {pending ? "Saving..." : "Continue"}
        </Button>
      </form>
    </div>
  );
}
