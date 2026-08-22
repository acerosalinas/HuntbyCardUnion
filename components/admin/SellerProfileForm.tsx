"use client";

import { ChangeEvent, FormEvent, useRef, useState, useTransition } from "react";
import { Store, Upload } from "lucide-react";
import { Input, Textarea } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { FRANCHISES } from "@/lib/franchises";
import { updateSellerProfile, uploadAvatarImage, SellerProfileInput } from "@/app/admin/actions";
import { SellerProfile } from "@/types/marketplace";

export function SellerProfileForm({ profile }: { profile: SellerProfile | null }) {
  const [handle, setHandle] = useState(profile?.handle ?? "");
  const [displayName, setDisplayName] = useState(profile?.displayName ?? "");
  const [bio, setBio] = useState(profile?.bio ?? "");
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatarUrl ?? "");
  const [sells, setSells] = useState(profile?.tags[0] ?? FRANCHISES[0].slug);
  const [liveModeSeconds, setLiveModeSeconds] = useState(profile?.liveModeSeconds ?? 4);
  const [facebookUrl, setFacebookUrl] = useState(profile?.facebookUrl ?? "");
  const [instagramUrl, setInstagramUrl] = useState(profile?.instagramUrl ?? "");
  const [messengerUsername, setMessengerUsername] = useState(profile?.messengerUsername ?? "");
  const [uploading, setUploading] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleAvatarSelected = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      setAvatarUrl(await uploadAvatarImage(formData));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload image");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    const input: SellerProfileInput = {
      handle,
      displayName,
      bio,
      avatarUrl,
      tags: [sells],
      liveModeSeconds,
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
          Avatar Image
        </label>
        <div className="flex items-center gap-3">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-gold bg-navy-950 text-gold">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- uploaded to Supabase Storage, not a local asset
              <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <Store size={20} />
            )}
          </div>
          <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
            <Upload size={14} />
            {uploading ? "Uploading..." : avatarUrl ? "Change Image" : "Upload Image"}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={handleAvatarSelected}
            className="hidden"
          />
        </div>
      </div>
      <div className="sm:col-span-2">
        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-foreground-muted">
          What do you sell?
        </label>
        <Select value={sells} onChange={(e) => setSells(e.target.value)}>
          {FRANCHISES.map((f) => (
            <option key={f.slug} value={f.slug}>
              {f.label}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-foreground-muted">
          Live Mode Speed <span className="normal-case text-foreground-muted/70">(seconds per card)</span>
        </label>
        <Input
          type="number"
          min={1}
          max={30}
          step={1}
          value={liveModeSeconds}
          onChange={(e) => setLiveModeSeconds(Number(e.target.value))}
        />
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
