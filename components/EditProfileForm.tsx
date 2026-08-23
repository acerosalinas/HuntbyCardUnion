"use client";

import { FormEvent, useState, useTransition } from "react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { updateBuyerProfile } from "@/app/account/actions";
import { Buyer } from "@/components/BuyerIdentityProvider";

export function EditProfileForm({ buyer }: { buyer: Buyer }) {
  const [fullName, setFullName] = useState(buyer.fullName);
  const [handle, setHandle] = useState(buyer.handle);
  const [email, setEmail] = useState(buyer.email);
  const [newPassword, setNewPassword] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);

    startTransition(async () => {
      try {
        const { emailChangePending } = await updateBuyerProfile({ fullName, handle, email, newPassword });
        setNewPassword("");
        setNotice(
          emailChangePending
            ? "Profile saved. Check your new email address for a confirmation link before it takes effect."
            : "Profile saved.",
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save profile");
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="w-full space-y-3 rounded-2xl border border-card-border bg-card p-4">
      <div>
        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-foreground-muted">
          Full Name
        </label>
        <Input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-foreground-muted">
          Handle
        </label>
        <Input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="@handle" required />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-foreground-muted">
          Email
        </label>
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-foreground-muted">
          New Password <span className="normal-case text-foreground-muted/70">(leave blank to keep current)</span>
        </label>
        <Input
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder="••••••••"
          autoComplete="new-password"
        />
      </div>

      {error && <p className="text-sm text-sold">{error}</p>}
      {notice && <p className="text-sm text-available">{notice}</p>}

      <Button type="submit" variant="gold" className="w-full" disabled={pending}>
        {pending ? "Saving..." : "Save Changes"}
      </Button>
    </form>
  );
}
