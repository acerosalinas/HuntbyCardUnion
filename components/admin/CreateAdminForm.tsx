"use client";

import { FormEvent, useState, useTransition } from "react";
import { Input } from "@/components/ui/Input";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { createAdminAccount } from "@/app/admin/actions";
import { AdminRole } from "@/lib/adminAuth";
import { extractErrorMessage } from "@/lib/utils";

export function CreateAdminForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<AdminRole>("ADMIN");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (!email || password.length < 6) {
      setError("Enter an email and a password of at least 6 characters.");
      return;
    }

    startTransition(async () => {
      try {
        await createAdminAccount(email, password, role);
        setEmail("");
        setPassword("");
        setRole("ADMIN");
        setSuccess(true);
      } catch (err) {
        setError(extractErrorMessage(err) ?? "Failed to create admin account");
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="grid gap-3 rounded-2xl border border-card-border bg-card p-4 sm:grid-cols-2">
      <div>
        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-foreground-muted">
          Email *
        </label>
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-foreground-muted">
          Password *
        </label>
        <PasswordInput
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={6}
          required
        />
      </div>
      <div className="sm:col-span-2">
        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-foreground-muted">
          Role *
        </label>
        <Select value={role} onChange={(e) => setRole(e.target.value as AdminRole)} className="max-w-xs">
          <option value="ADMIN">Admin (sees only their own listings)</option>
          <option value="SUPER_ADMIN">Super Admin (sees every admin&apos;s listings)</option>
        </Select>
      </div>

      {error && <p className="text-sm text-sold sm:col-span-2">{error}</p>}
      {success && <p className="text-sm text-available sm:col-span-2">Admin account created.</p>}

      <div className="sm:col-span-2">
        <Button type="submit" variant="gold" disabled={pending}>
          {pending ? "Creating..." : "Create Admin Account"}
        </Button>
      </div>
    </form>
  );
}
