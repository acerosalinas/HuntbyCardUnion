"use client";

import { FormEvent, useState, useTransition } from "react";
import { Input, Textarea } from "@/components/ui/Input";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { Button } from "@/components/ui/Button";
import { updateBuyerProfile } from "@/app/account/actions";
import { Buyer } from "@/components/BuyerIdentityProvider";
import { extractErrorMessage } from "@/lib/utils";

export function EditProfileForm({ buyer }: { buyer: Buyer }) {
  const [fullName, setFullName] = useState(buyer.fullName);
  const [handle, setHandle] = useState(buyer.handle);
  const [email, setEmail] = useState(buyer.email);
  const [newPassword, setNewPassword] = useState("");
  const [shipName, setShipName] = useState(buyer.shipName ?? buyer.fullName);
  const [shipPhone, setShipPhone] = useState(buyer.shipPhone ?? "");
  const [shipAddress, setShipAddress] = useState(buyer.shipAddress ?? "");
  const [shipZip, setShipZip] = useState(buyer.shipZip ?? "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);

    startTransition(async () => {
      try {
        const { emailChangePending } = await updateBuyerProfile({
          fullName,
          handle,
          email,
          newPassword,
          shipName,
          shipPhone,
          shipAddress,
          shipZip,
        });
        setNewPassword("");
        setNotice(
          emailChangePending
            ? "Profile saved. Check your new email address for a confirmation link before it takes effect."
            : "Profile saved.",
        );
      } catch (err) {
        setError(extractErrorMessage(err) ?? "Failed to save profile");
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
        <PasswordInput
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder="••••••••"
          autoComplete="new-password"
        />
      </div>

      <div className="border-t border-card-border pt-3">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-foreground-muted">
          Default Shipping Info
        </p>
        <p className="mb-3 text-xs text-foreground-muted">
          Used to pre-fill checkout so you don&apos;t have to retype it every order - you can still edit it per order.
        </p>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-foreground-muted">
          Shipping Name
        </label>
        <Input value={shipName} onChange={(e) => setShipName(e.target.value)} />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-foreground-muted">
          Phone Number
        </label>
        <Input type="tel" value={shipPhone} onChange={(e) => setShipPhone(e.target.value)} />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-foreground-muted">
          Address
        </label>
        <Textarea rows={2} value={shipAddress} onChange={(e) => setShipAddress(e.target.value)} />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-foreground-muted">
          Zip Code
        </label>
        <Input value={shipZip} onChange={(e) => setShipZip(e.target.value)} />
      </div>

      {error && <p className="text-sm text-sold">{error}</p>}
      {notice && <p className="text-sm text-available">{notice}</p>}

      <Button type="submit" variant="gold" className="w-full" disabled={pending}>
        {pending ? "Saving..." : "Save Changes"}
      </Button>
    </form>
  );
}
