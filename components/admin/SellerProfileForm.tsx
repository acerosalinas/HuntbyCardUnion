"use client";

import { FormEvent, useState, useTransition } from "react";
import { Input, Textarea } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { updateSellerProfile, SellerProfileInput } from "@/app/admin/actions";
import { SellerProfile } from "@/types/marketplace";

export function SellerProfileForm({ profile }: { profile: SellerProfile | null }) {
  const [handle, setHandle] = useState(profile?.handle ?? "");
  const [displayName, setDisplayName] = useState(profile?.displayName ?? "");
  const [bio, setBio] = useState(profile?.bio ?? "");
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatarUrl ?? "");
  const [tags, setTags] = useState(profile?.tags.join(", ") ?? "");
  const [facebookUrl, setFacebookUrl] = useState(profile?.facebookUrl ?? "");
  const [instagramUrl, setInstagramUrl] = useState(profile?.instagramUrl ?? "");
  const [messengerUsername, setMessengerUsername] = useState(profile?.messengerUsername ?? "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    const input: SellerProfileInput = {
      handle,
      displayName,
      bio,
      avatarUrl,
      tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
      facebookUrl,
      instagramUrl,
      messengerUsername,
    };

    startTransition(async () => {
      try {
        await updateSellerProfile(input);
        setSuccess(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save profile");
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="grid gap-3 rounded-2xl border border-card-border bg-card p-4 sm:grid-cols-2">
      <div>
        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-foreground-muted">
          Handle * <span className="normal-case text-foreground-muted/70">(used in your profile URL)</span>
        </label>
        <Input
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          placeholder="e.g. cardking"
          required
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-foreground-muted">
          Display Name *
        </label>
        <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
      </div>
      <div className="sm:col-span-2">
        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-foreground-muted">Bio</label>
        <Textarea rows={3} value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Tell buyers a bit about yourself..." />
      </div>
      <div className="sm:col-span-2">
        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-foreground-muted">
          Avatar Image URL
        </label>
        <Input value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} placeholder="https://..." />
      </div>
      <div className="sm:col-span-2">
        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-foreground-muted">
          What do you sell? <span className="normal-case text-foreground-muted/70">(comma-separated tags, e.g. pokemon, one-piece, sports)</span>
        </label>
        <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="pokemon, one-piece" />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-foreground-muted">
          Facebook URL
        </label>
        <Input value={facebookUrl} onChange={(e) => setFacebookUrl(e.target.value)} placeholder="https://facebook.com/..." />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-foreground-muted">
          Instagram URL
        </label>
        <Input value={instagramUrl} onChange={(e) => setInstagramUrl(e.target.value)} placeholder="https://instagram.com/..." />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-foreground-muted">
          Messenger Username
        </label>
        <Input value={messengerUsername} onChange={(e) => setMessengerUsername(e.target.value)} placeholder="your.messenger.username" />
      </div>

      {error && <p className="text-sm text-sold sm:col-span-2">{error}</p>}
      {success && <p className="text-sm text-available sm:col-span-2">Profile saved.</p>}

      <div className="sm:col-span-2">
        <Button type="submit" variant="gold" disabled={pending}>
          {pending ? "Saving..." : "Save Profile"}
        </Button>
      </div>
    </form>
  );
}
