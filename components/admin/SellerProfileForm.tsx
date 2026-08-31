"use client";

import { ChangeEvent, FormEvent, useRef, useState, useTransition } from "react";
import { QrCode, Store, Upload } from "lucide-react";
import { Input, Textarea } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { FRANCHISES } from "@/lib/franchises";
import { extractErrorMessage } from "@/lib/utils";
import { checkImageTypeClientSide, ACCEPTED_IMAGE_ACCEPT_ATTR } from "@/lib/imageAccept";
import { normalizeImageFile } from "@/lib/imageNormalize";
import { weekdayLabel } from "@/lib/codSchedule";
import { updateSellerProfile, uploadAvatarImage, uploadPaymentQrImage, SellerProfileInput } from "@/app/admin/actions";
import { SellerProfile } from "@/types/marketplace";

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

// Mirrors HANDLE_PATTERN in app/admin/actions.ts - validated here too so a
// bad handle is caught before ever calling the server action. Server
// Actions invoked directly (not through useActionState) have their thrown
// error messages redacted in production - the client only ever sees a
// generic "Minified React error" - so a validation mistake needs to be
// caught client-side to actually be readable to the seller.
const HANDLE_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

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
  const [paymentQrUrl, setPaymentQrUrl] = useState(profile?.paymentQrUrl ?? "");
  const [codEnabled, setCodEnabled] = useState(profile?.codEnabled ?? false);
  const [codWeekday, setCodWeekday] = useState<number>(profile?.codWeekday ?? 5);
  const [uploading, setUploading] = useState(false);
  const [uploadingQr, setUploadingQr] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const qrInputRef = useRef<HTMLInputElement>(null);

  const handleAvatarSelected = async (e: ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    if (!picked) return;
    setError(null);
    setUploading(true);
    try {
      const file = await normalizeImageFile(picked);
      const typeError = checkImageTypeClientSide(file);
      if (typeError) {
        setError(typeError);
        return;
      }
      const formData = new FormData();
      formData.append("file", file);
      setAvatarUrl(await uploadAvatarImage(formData));
    } catch (err) {
      setError(extractErrorMessage(err) ?? "Failed to upload image");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleQrSelected = async (e: ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    if (!picked) return;
    setError(null);
    setUploadingQr(true);
    try {
      const file = await normalizeImageFile(picked);
      const typeError = checkImageTypeClientSide(file);
      if (typeError) {
        setError(typeError);
        return;
      }
      const formData = new FormData();
      formData.append("file", file);
      setPaymentQrUrl(await uploadPaymentQrImage(formData));
    } catch (err) {
      setError(extractErrorMessage(err) ?? "Failed to upload QR code");
    } finally {
      setUploadingQr(false);
      if (qrInputRef.current) qrInputRef.current.value = "";
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    const normalizedHandle = handle.trim().toLowerCase();
    if (!HANDLE_PATTERN.test(normalizedHandle)) {
      setError("Handle must be lowercase letters, numbers, and hyphens only (no spaces or symbols) - e.g. cardking or card-king.");
      return;
    }
    if (!displayName.trim()) {
      setError("Display name is required.");
      return;
    }
    if (codEnabled && (codWeekday < 0 || codWeekday > 6)) {
      setError("Pick a weekday for Cash on Delivery shipping.");
      return;
    }

    const input: SellerProfileInput = {
      handle: normalizedHandle,
      displayName,
      bio,
      avatarUrl,
      tags: [sells],
      liveModeSeconds,
      facebookUrl,
      instagramUrl,
      messengerUsername,
      paymentQrUrl,
      codEnabled,
      codWeekday: codEnabled ? codWeekday : null,
    };

    startTransition(async () => {
      try {
        await updateSellerProfile(input);
        setSuccess(true);
      } catch (err) {
        setError(extractErrorMessage(err) ?? "Failed to save profile");
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
          placeholder="e.g. card-king (lowercase, numbers, hyphens only)"
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
            accept={ACCEPTED_IMAGE_ACCEPT_ATTR}
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

      <div className="sm:col-span-2">
        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-foreground-muted">
          Payment QR Code <span className="normal-case text-foreground-muted/70">(GCash or bank - shown to buyers at checkout)</span>
        </label>
        <div className="flex items-center gap-3">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border-2 border-gold bg-navy-950 text-gold">
            {paymentQrUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- uploaded to Supabase Storage, not a local asset
              <img src={paymentQrUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <QrCode size={20} />
            )}
          </div>
          <Button type="button" variant="outline" onClick={() => qrInputRef.current?.click()} disabled={uploadingQr}>
            <Upload size={14} />
            {uploadingQr ? "Uploading..." : paymentQrUrl ? "Change QR" : "Upload QR"}
          </Button>
          <input
            ref={qrInputRef}
            type="file"
            accept={ACCEPTED_IMAGE_ACCEPT_ATTR}
            onChange={handleQrSelected}
            className="hidden"
          />
        </div>
      </div>

      <div className="sm:col-span-2 rounded-xl border border-card-border p-3">
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={codEnabled}
            onChange={(e) => setCodEnabled(e.target.checked)}
            className="h-4 w-4 rounded border-card-border accent-gold"
          />
          Offer Cash on Delivery
        </label>
        {codEnabled && (
          <div className="mt-2">
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-foreground-muted">
              Regular COD shipping day
            </label>
            <Select value={codWeekday} onChange={(e) => setCodWeekday(Number(e.target.value))} className="max-w-56">
              {WEEKDAYS.map((day) => (
                <option key={day} value={day}>
                  {weekdayLabel(day)}
                </option>
              ))}
            </Select>
            <p className="mt-1 text-xs text-foreground-muted">
              Any COD order goes out on the next {weekdayLabel(codWeekday)} - not physically automated, just what buyers see displayed.
            </p>
          </div>
        )}
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
