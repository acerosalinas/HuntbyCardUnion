"use client";

import { ChangeEvent, FormEvent, useRef, useState, useTransition } from "react";
import { ImagePlus, X } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import { FRANCHISES } from "@/lib/franchises";
import { raritiesForFranchise, DEFAULT_RARITY } from "@/lib/rarity";
import { createCard, updateCard, uploadCardImages } from "@/app/admin/actions";
import { CardItem } from "@/types/marketplace";

type CardType = "RAW" | "GRADED";

const CONDITIONS = [
  { value: "NM", label: "Near Mint (NM)" },
  { value: "LP", label: "Lightly Played (LP)" },
  { value: "MP", label: "Moderately Played (MP)" },
  { value: "HP", label: "Highly Played (HP)" },
  { value: "DMG", label: "Damage (DMG)" },
];

const GRADERS = ["PSA", "TAG", "BECKETT", "CGC"];

const GRADE_NUMBERS = Array.from({ length: 19 }, (_, i) => (1 + i * 0.5).toString());

interface FormState {
  title: string;
  setName: string;
  price: string;
  cardType: CardType;
  condition: string;
  grader: string;
  gradeNumber: string;
  sellerHandle: string;
  sellerMessenger: string;
  isFlashSale: boolean;
  franchise: string;
  quantity: string;
  rarity: string;
}

const emptyForm: FormState = {
  title: "",
  setName: "",
  price: "",
  cardType: "RAW",
  condition: "NM",
  grader: "PSA",
  gradeNumber: "10",
  sellerHandle: "",
  sellerMessenger: "CardUnion1",
  isFlashSale: false,
  franchise: FRANCHISES[0].slug,
  quantity: "1",
  rarity: DEFAULT_RARITY,
};

/** Best-effort reverse-parse of a stored "Raw NM" / "PSA 10" string back into structured fields. */
function parseConditionGrade(value: string): Pick<FormState, "cardType" | "condition" | "grader" | "gradeNumber"> {
  const trimmed = value.trim();

  const rawMatch = /^raw\s*(.*)$/i.exec(trimmed);
  if (rawMatch) {
    const cond = rawMatch[1].trim().toUpperCase();
    const matched = CONDITIONS.find((c) => c.value === cond);
    return { cardType: "RAW", condition: matched ? matched.value : "NM", grader: "PSA", gradeNumber: "10" };
  }

  const gradedMatch = /^(\S+)\s+([\d.]+)/.exec(trimmed);
  if (gradedMatch) {
    const graderRaw = gradedMatch[1].toUpperCase();
    const grader = GRADERS.includes(graderRaw) ? graderRaw : graderRaw === "BGS" ? "BECKETT" : GRADERS[0];
    const numeric = Number(gradedMatch[2]);
    const gradeNumber = GRADE_NUMBERS.find((n) => Number(n) === numeric) ?? "10";
    return { cardType: "GRADED", condition: "NM", grader, gradeNumber };
  }

  return { cardType: "RAW", condition: "NM", grader: "PSA", gradeNumber: "10" };
}

function formStateFromCard(card: CardItem): FormState {
  const franchise = card.franchise ?? FRANCHISES[0].slug;
  return {
    title: card.title,
    setName: card.setName,
    price: String(card.price),
    ...parseConditionGrade(card.conditionGrade),
    sellerHandle: card.sellerHandle,
    sellerMessenger: card.sellerMessenger,
    isFlashSale: card.isFlashSale,
    franchise,
    quantity: String(card.quantity),
    // Falls back to DEFAULT_RARITY if the stored value isn't in this
    // franchise's current list (e.g. a card saved before rarity became
    // per-franchise, or moved to a franchise it doesn't fit) - keeps the
    // <select> from holding a value with no matching <option>.
    rarity: card.rarity && raritiesForFranchise(franchise).includes(card.rarity) ? card.rarity : DEFAULT_RARITY,
  };
}

interface InventoryFormProps {
  /** Present => edit an existing listing instead of creating a new one. */
  card?: CardItem;
  onSuccess?: () => void;
}

export function InventoryForm({ card, onSuccess }: InventoryFormProps) {
  const isEdit = Boolean(card);
  const [form, setForm] = useState<FormState>(() => (card ? formStateFromCard(card) : emptyForm));
  const [images, setImages] = useState<string[]>(card?.images ?? []);
  const [uploading, setUploading] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  // Rarity vocabulary is per-franchise (see lib/rarity.ts) - switching
  // franchise resets the rarity choice if it doesn't exist in the new
  // franchise's list, so the form never holds an invalid combination.
  const handleFranchiseChange = (franchise: string) => {
    setForm((f) => ({
      ...f,
      franchise,
      rarity: raritiesForFranchise(franchise).includes(f.rarity) ? f.rarity : DEFAULT_RARITY,
    }));
  };

  const handleFilesSelected = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setError(null);
    setUploading(true);
    try {
      const formData = new FormData();
      Array.from(files).forEach((file) => formData.append("files", file));
      const urls = await uploadCardImages(formData);
      setImages((prev) => [...prev, ...urls]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload image(s)");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const removeImage = (url: string) => {
    setImages((prev) => prev.filter((u) => u !== url));
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    const price = Number(form.price);
    if (!form.title || !form.setName || !price || !form.sellerHandle || !form.sellerMessenger) {
      setError("Fill in all required fields.");
      return;
    }

    const conditionGrade =
      form.cardType === "RAW" ? `Raw ${form.condition}` : `${form.grader} ${form.gradeNumber}`;

    const input = {
      title: form.title,
      setName: form.setName,
      price,
      conditionGrade,
      rarity: form.rarity,
      images,
      sellerHandle: form.sellerHandle,
      sellerMessenger: form.sellerMessenger,
      isFlashSale: form.isFlashSale,
      franchise: form.franchise,
      quantity: Math.max(1, Math.round(Number(form.quantity)) || 1),
    };

    startTransition(async () => {
      try {
        if (card) {
          await updateCard(card.id, input);
        } else {
          await createCard(input);
          setForm(emptyForm);
          setImages([]);
        }
        setSuccess(true);
        onSuccess?.();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save listing");
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="grid gap-3 rounded-2xl border border-card-border bg-card p-4 sm:grid-cols-2">
      <Field label="Title *">
        <Input value={form.title} onChange={(e) => set("title", e.target.value)} required />
      </Field>
      <Field label="Set Name *">
        <Input value={form.setName} onChange={(e) => set("setName", e.target.value)} required />
      </Field>
      <Field label="Price (₱) *">
        <Input type="number" min={0} step="0.01" value={form.price} onChange={(e) => set("price", e.target.value)} required />
      </Field>
      <Field label="Quantity *">
        <Input
          type="number"
          min={card ? card.quantity - card.quantityAvailable || 1 : 1}
          step="1"
          value={form.quantity}
          onChange={(e) => set("quantity", e.target.value)}
          required
        />
        {card && card.quantity - card.quantityAvailable > 0 && (
          <p className="mt-1 text-xs text-foreground-muted">
            {card.quantity - card.quantityAvailable} already claimed - can&apos;t go below that.
          </p>
        )}
      </Field>
      <Field label="Seller Handle *">
        <Input placeholder="@seller" value={form.sellerHandle} onChange={(e) => set("sellerHandle", e.target.value)} required />
      </Field>

      <Field label="Franchise *" className="sm:col-span-2">
        <Select value={form.franchise} onChange={(e) => handleFranchiseChange(e.target.value)}>
          {FRANCHISES.map((f) => (
            <option key={f.slug} value={f.slug}>
              {f.label}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Rarity *" className="sm:col-span-2">
        <Select value={form.rarity} onChange={(e) => set("rarity", e.target.value)}>
          {raritiesForFranchise(form.franchise).map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Card Type *" className="sm:col-span-2">
        <div className="flex gap-2">
          {(["RAW", "GRADED"] as const).map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => set("cardType", type)}
              className={cn(
                "rounded-lg border px-4 py-2 text-sm font-medium transition-colors",
                form.cardType === type
                  ? "border-gold bg-gold text-navy-950"
                  : "border-card-border text-foreground-muted hover:border-gold/50 hover:text-foreground",
              )}
            >
              {type === "RAW" ? "Raw" : "Graded"}
            </button>
          ))}
        </div>
      </Field>

      {form.cardType === "RAW" ? (
        <Field label="Condition *" className="sm:col-span-2">
          <Select value={form.condition} onChange={(e) => set("condition", e.target.value)}>
            {CONDITIONS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <>
          <Field label="Grader *">
            <Select value={form.grader} onChange={(e) => set("grader", e.target.value)}>
              {GRADERS.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Grade *">
            <Select value={form.gradeNumber} onChange={(e) => set("gradeNumber", e.target.value)}>
              {GRADE_NUMBERS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </Field>
        </>
      )}

      <Field label="Seller Messenger Username *">
        <Input placeholder="username in m.me/username" value={form.sellerMessenger} onChange={(e) => set("sellerMessenger", e.target.value)} required />
      </Field>

      <Field label="Card Images" className="sm:col-span-2">
        <div className="flex flex-wrap gap-3">
          {images.map((url) => (
            <div key={url} className="group relative h-20 w-20 overflow-hidden rounded-lg border border-card-border">
              {/* eslint-disable-next-line @next/next/no-img-element -- uploaded to Supabase Storage, not a local asset */}
              <img src={url} alt="" className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => removeImage(url)}
                aria-label="Remove image"
                className="absolute right-1 top-1 rounded-full bg-navy-950/80 p-0.5 text-ivory opacity-0 transition-opacity group-hover:opacity-100"
              >
                <X size={12} />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-card-border text-foreground-muted transition-colors hover:border-gold hover:text-gold disabled:opacity-60"
          >
            <ImagePlus size={18} />
            <span className="text-[10px]">{uploading ? "Uploading..." : "Add"}</span>
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          onChange={handleFilesSelected}
          className="hidden"
        />
      </Field>

      <label className="flex items-center gap-2 text-sm text-foreground-muted sm:col-span-2">
        <input
          type="checkbox"
          checked={form.isFlashSale}
          onChange={(e) => set("isFlashSale", e.target.checked)}
          className="h-4 w-4 rounded border-card-border accent-gold"
        />
        Mark as Flash Sale
      </label>

      {error && <p className="text-sm text-sold sm:col-span-2">{error}</p>}
      {success && !isEdit && <p className="text-sm text-available sm:col-span-2">Listing created.</p>}

      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" variant="gold" disabled={pending || uploading}>
          {pending ? "Saving..." : isEdit ? "Save Changes" : "Add Listing"}
        </Button>
      </div>
    </form>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-foreground-muted">
        {label}
      </label>
      {children}
    </div>
  );
}
