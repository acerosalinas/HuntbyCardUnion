"use client";

import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import { ImagePlus, Search, Trash2, X } from "lucide-react";
import { CatalogPicker } from "@/components/CatalogPicker";
import { searchOnePieceCards, searchPokemonCards } from "@/app/catalog/actions";
import { onePieceListingTitle } from "@/lib/onepieceCatalog";
import { catalogCardLabel, catalogImageUrl } from "@/lib/pokemonCatalog";
import { Button } from "@/components/ui/Button";
import { useBuyerIdentity } from "@/components/BuyerIdentityProvider";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { extractErrorMessage } from "@/lib/utils";
import { BUDGET_TYPE_LABEL, BudgetType, budgetLabel, parseBudget } from "@/lib/wantedBudget";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { checkImageTypeClientSide, ACCEPTED_IMAGE_ACCEPT_ATTR } from "@/lib/imageAccept";
import { normalizeImageFile } from "@/lib/imageNormalize";
import { announceWishlistAdded, uploadWantedCardPhoto } from "@/app/account/actions";
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
  // Which game the card search looks in (both are always available; the buyer picks).
  const [game, setGame] = useState<"pokemon" | "one-piece">("pokemon");
  const [photoUrl, setPhotoUrl] = useState("");
  // Optional: what the buyer is willing to spend, so sellers know whether the request is worth chasing.
  const [budgetType, setBudgetType] = useState<BudgetType>("UNDER");
  const [budgetAmount, setBudgetAmount] = useState("");
  // True while the photo is the catalog picture of the picked card (replaced if another card is picked; never overwrites an upload).
  const [photoFromCatalog, setPhotoFromCatalog] = useState(false);
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
      setPhotoUrl(await uploadWantedCardPhoto(formData));
      setPhotoFromCatalog(false);
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
    const parsedBudget = parseBudget(budgetType, budgetAmount);
    if (parsedBudget.error) {
      setError(parsedBudget.error);
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const supabase = createClient();
      const { data, error: insertError } = await supabase
        .from("wanted_cards")
        .insert({
          buyer_id: buyer.id,
          buyer_handle: buyer.handle,
          card_name: cardName.trim(),
          photo_url: photoUrl,
          // Only sent when a budget was given, so a request without one never depends on the budget columns.
          ...(parsedBudget.budget ? { budget_amount: parsedBudget.budget.amount, budget_type: parsedBudget.budget.type } : {}),
        })
        .select("*")
        .single();
      if (insertError) throw insertError;
      setWanted((prev) => [wantedCardFromRow(data as WantedCardRow), ...prev]);
      // Tell the admin about the new request (bell + email). Fire-and-forget; it never throws.
      void announceWishlistAdded("wanted", (data as WantedCardRow).id).catch(() => {});
      setCardName("");
      setPhotoUrl("");
      setBudgetAmount("");
      setPhotoFromCatalog(false);
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
        <div className="flex-1">
          <div className="mb-1.5 flex gap-1.5" role="group" aria-label="Which game">
            {([["pokemon", "Pokémon"], ["one-piece", "One Piece"]] as const).map(([slug, label]) => (
              <button
                key={slug}
                type="button"
                onClick={() => setGame(slug)}
                aria-pressed={game === slug}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${game === slug ? "border-gold bg-gold/15 text-gold-ink" : "border-card-border text-foreground-muted hover:text-foreground"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <CatalogPicker
            key={game}
            value={cardName}
            onValueChange={setCardName}
            onPick={(c) => {
              setCardName(game === "one-piece" ? onePieceListingTitle({ name: c.name, number: c.number, variant: c.variant, lang: c.lang }) : catalogCardLabel(c));
              const picture = catalogImageUrl(c.image, "high");
              if (picture && (!photoUrl || photoFromCatalog)) {
                setPhotoUrl(picture);
                setPhotoFromCatalog(true);
              }
            }}
            search={game === "one-piece" ? searchOnePieceCards : searchPokemonCards}
            placeholder={game === "one-piece" ? "Card name (e.g. Luffy OP01, add JP for Japanese)" : "Card name (e.g. Charizard ex Base Set)"}
          />
        </div>
        <div className="flex items-center gap-2">
          {photoUrl ? (
            <div className="group relative h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-gold/40">
              {/* eslint-disable-next-line @next/next/no-img-element -- uploaded to Supabase Storage, not a local asset */}
              <img src={photoUrl} alt="" className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => {
                  setPhotoUrl("");
                  setPhotoFromCatalog(false);
                }}
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
            accept={ACCEPTED_IMAGE_ACCEPT_ATTR}
            onChange={handlePhotoSelected}
            className="hidden"
          />
          <Button type="submit" variant="gold" disabled={submitting || uploading}>
            {submitting ? "Sending..." : "Request"}
          </Button>
        </div>
      </form>

      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor="wanted-budget-type" className="mb-1 block text-xs font-medium uppercase tracking-wide text-foreground-muted">
            Budget (optional)
          </label>
          <Select id="wanted-budget-type" value={budgetType} onChange={(e) => setBudgetType(e.target.value as BudgetType)} className="w-auto">
            <option value="UNDER">{BUDGET_TYPE_LABEL.UNDER}</option>
            <option value="OVER">{BUDGET_TYPE_LABEL.OVER}</option>
          </Select>
        </div>
        <div className="w-36">
          <label htmlFor="wanted-budget-amount" className="sr-only">
            Budget amount in pesos
          </label>
          <Input
            id="wanted-budget-amount"
            type="number"
            inputMode="decimal"
            min={0.01}
            step="0.01"
            value={budgetAmount}
            onChange={(e) => setBudgetAmount(e.target.value)}
            placeholder="₱ amount"
          />
        </div>
        <p className="min-w-48 flex-1 pb-2 text-xs text-foreground-muted">How much you&apos;re willing to spend, so sellers know if it&apos;s worth finding. Leave it empty if you&apos;re not sure.</p>
      </div>

      {error && <p className="text-sm text-sold">{error}</p>}

      {wanted.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-card-border pt-3">
          {wanted.map((w) => (
            <div key={w.id} className="flex items-center gap-2 rounded-lg border border-card-border bg-background-elevated px-2 py-1.5">
              {/* eslint-disable-next-line @next/next/no-img-element -- uploaded to Supabase Storage, not a local asset */}
              <img src={w.photoUrl} alt="" className="h-8 w-8 rounded object-cover" />
              <span className="max-w-32 truncate text-xs text-foreground">{w.cardName}</span>
              {budgetLabel(w.budgetType, w.budgetAmount) && (
                <span className="rounded-full bg-gold/15 px-1.5 py-0.5 text-[10px] font-semibold text-gold-ink">{budgetLabel(w.budgetType, w.budgetAmount)}</span>
              )}
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
