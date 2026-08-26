"use client";

import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import { ImagePlus, Search, Trash2, X } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { useBuyerIdentity } from "@/components/BuyerIdentityProvider";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { extractErrorMessage } from "@/lib/utils";
import { checkImageTypeClientSide } from "@/lib/imageAccept";
import { uploadWantedCardPhoto } from "@/app/account/actions";
import { WantedCard, WantedCardRow, wantedCardFromRow } from "@/types/marketplace";

/**
 * A buyer's "can't find it" request for a card not yet listed - name + a
 * reference photo, visible to every admin as a shared want-list (see
 * app/admin/(dashboard)/wanted/page.tsx). Lives on /account/wishlist since
 * that's where a buyer already goes to track cards they want.
 */
export function WantedCardForm() {
  const { buyer } = useBuyerIdentity();
  const [cardName, setCardName] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wanted, setWanted] = useState<WantedCard[]>([]);
  const [loading, setLoading] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!buyer || !isSupabaseConfigured()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- no buyer signed in, nothing to load
      setLoading(false);
      return;
    }
    let active = true;
    const supabase = createClient();
    supabase
      .from("wanted_cards")
      .select("*")
      .eq("buyer_id", buyer.id)
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (!active) return;
        setWanted(((data as WantedCardRow[] | null) ?? []).map(wantedCardFromRow));
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [buyer]);

  const handlePhotoSelected = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    const typeError = checkImageTypeClientSide(file);
    if (typeError) {
      setError(typeError);
      e.target.value = "";
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      setPhotoUrl(await uploadWantedCardPhoto(formData));
    } catch (err) {
      setError(extractErrorMessage(err) ?? "Failed to upload photo");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!buyer) return;
    if (!cardName.trim()) {
      setError("Enter the card's name.");
      return;
    }
    if (!photoUrl) {
      setError("Add a reference photo.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const supabase = createClient();
      const { data, error: insertError } = await supabase
        .from("wanted_cards")
        .insert({ buyer_id: buyer.id, buyer_handle: buyer.handle, card_name: cardName.trim(), photo_url: photoUrl })
        .select("*")
        .single();
      if (insertError) throw insertError;
      setWanted((prev) => [wantedCardFromRow(data as WantedCardRow), ...prev]);
      setCardName("");
      setPhotoUrl("");
    } catch (err) {
      setError(extractErrorMessage(err) ?? "Failed to submit request");
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemove = async (id: string) => {
    const supabase = createClient();
    setWanted((prev) => prev.filter((w) => w.id !== id));
    await supabase.from("wanted_cards").delete().eq("id", id);
  };

  if (!buyer || loading) return null;

  return (
    <div className="mt-8 space-y-4 rounded-2xl border border-card-border bg-card p-4">
      <div>
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <Search size={15} className="text-gold" />
          Can&apos;t find a card?
        </h2>
        <p className="text-xs text-foreground-muted">
          Tell us what you&apos;re hunting for - sellers can see requests and may list it for you.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <Input
          placeholder="Card name (e.g. Charizard ex Base Set)"
          value={cardName}
          onChange={(e) => setCardName(e.target.value)}
          className="flex-1"
        />
        <div className="flex items-center gap-2">
          {photoUrl ? (
            <div className="group relative h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-gold/40">
              {/* eslint-disable-next-line @next/next/no-img-element -- uploaded to Supabase Storage, not a local asset */}
              <img src={photoUrl} alt="" className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => setPhotoUrl("")}
                aria-label="Remove photo"
                className="absolute inset-0 flex items-center justify-center bg-navy-950/70 text-ivory opacity-0 transition-opacity group-hover:opacity-100"
              >
                <X size={14} />
              </button>
            </div>
          ) : (
            <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
              <ImagePlus size={14} />
              {uploading ? "Uploading..." : "Photo"}
            </Button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={handlePhotoSelected}
            className="hidden"
          />
          <Button type="submit" variant="gold" disabled={submitting || uploading}>
            {submitting ? "Sending..." : "Request"}
          </Button>
        </div>
      </form>

      {error && <p className="text-sm text-sold">{error}</p>}

      {wanted.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-card-border pt-3">
          {wanted.map((w) => (
            <div key={w.id} className="flex items-center gap-2 rounded-lg border border-card-border bg-background-elevated px-2 py-1.5">
              {/* eslint-disable-next-line @next/next/no-img-element -- uploaded to Supabase Storage, not a local asset */}
              <img src={w.photoUrl} alt="" className="h-8 w-8 rounded object-cover" />
              <span className="max-w-32 truncate text-xs text-foreground">{w.cardName}</span>
              {w.status !== "OPEN" && (
                <span className="rounded-full bg-available-bg px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-available">
                  {w.status === "FULFILLED" ? "Found" : "Closed"}
                </span>
              )}
              <button
                type="button"
                onClick={() => handleRemove(w.id)}
                aria-label="Remove request"
                className="text-foreground-muted transition-colors hover:text-sold"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
