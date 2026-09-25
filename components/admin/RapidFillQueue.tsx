"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ChevronLeft, ChevronRight, ImageOff, Minus, Plus, RotateCcw, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { cn, extractErrorMessage } from "@/lib/utils";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { FRANCHISES } from "@/lib/franchises";
import { raritiesForFranchise, DEFAULT_RARITY } from "@/lib/rarity";
import { POKEMON_TYPES } from "@/lib/pokemonType";
import { CONDITION_LABELS, ConditionCode, parseConditionGrade } from "@/lib/conditionGrade";
import { deleteCard, publishDrafts, updateCard } from "@/app/admin/actions";
import { CardItem } from "@/types/marketplace";

type CardType = "RAW" | "GRADED";
const GRADERS = ["PSA", "TAG", "BECKETT", "CGC"];
const GRADE_NUMBERS = Array.from({ length: 19 }, (_, i) => (1 + i * 0.5).toString());
const ZOOM_STEPS = [1, 1.5, 2, 2.5, 3];

interface FormState {
  title: string;
  setName: string;
  price: string;
  quantity: string;
  franchise: string;
  rarity: string;
  /** Pokemon TCG energy type - only meaningful/shown when franchise === "pokemon"; cleared to null otherwise. */
  pokemonType: string | null;
  cardType: CardType;
  condition: ConditionCode;
  grader: string;
  gradeNumber: string;
}

function formStateFromCard(card: CardItem): FormState {
  const parsed = parseConditionGrade(card.conditionGrade);
  const franchise = card.franchise ?? FRANCHISES[0].slug;
  return {
    title: card.title,
    setName: card.setName,
    price: String(card.price),
    quantity: String(card.quantity),
    franchise,
    // Falls back to DEFAULT_RARITY if the stored value isn't in this
    // franchise's current list (e.g. a card saved before rarity became
    // per-franchise) - keeps the <select> from holding a value with no
    // matching <option>.
    rarity: card.rarity && raritiesForFranchise(franchise).includes(card.rarity) ? card.rarity : DEFAULT_RARITY,
    pokemonType:
      franchise === "pokemon"
        ? card.pokemonType && (POKEMON_TYPES as readonly string[]).includes(card.pokemonType)
          ? card.pokemonType
          : POKEMON_TYPES[0]
        : null,
    cardType: parsed.type,
    condition: parsed.type === "RAW" ? parsed.condition : "NM",
    grader: parsed.type === "GRADED" ? parsed.grader : GRADERS[0],
    gradeNumber: parsed.type === "GRADED" ? parsed.gradeNumber : "10",
  };
}

/**
 * Two-panel Rapid Fill: a zoomable preview of the current draft's photo on
 * the left, and a form on the right for exactly the fields that differ card
 * to card (name, set, franchise, condition/grade, price) - seller
 * handle/messenger/flash-sale come from the seller's profile at
 * createDraftCards() time and aren't re-asked here, since the whole point
 * is minimizing repetitive typing across a big batch.
 */
export function RapidFillQueue({ initialDrafts }: { initialDrafts: CardItem[] }) {
  const router = useRouter();
  const [queue, setQueue] = useState(initialDrafts);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [form, setForm] = useState<FormState>(() => formStateFromCard(initialDrafts[0]));
  const [zoom, setZoom] = useState(1);
  const [saving, setSaving] = useState(false);
  const confirm = useConfirm();
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Which draft's photo has finished loading - compared against the current
  // draft's id instead of a boolean, so switching cards needs no "reset to
  // not-loaded" step (the new card simply isn't the loaded one yet).
  const [loadedImageId, setLoadedImageId] = useState<string | null>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const isFirstRender = useRef(true);

  const current = queue[currentIndex] as CardItem | undefined;
  const imageLoaded = current ? loadedImageId === current.id : false;

  // Brings the photo + progress back into view after moving to another card.
  // On a phone the photo sits above the form, so after tapping Save at the
  // bottom of the form the new photo was off-screen - the form fields changed
  // but nothing visibly did, which read as "the image didn't switch".
  const revealTop = () => {
    topRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    // Only steal focus on devices with a real pointer/keyboard - focusing a
    // field on a phone opens the keyboard and scrolls the photo away again.
    if (window.matchMedia("(pointer: fine)").matches) titleRef.current?.focus({ preventScroll: true });
  };

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    revealTop();
  }, [current?.id]);

  useEffect(() => {
    if (current) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- loading the active draft's fields into the form whenever the queue position changes
      setForm(formStateFromCard(current));
    }
    setZoom(1);
    setError(null);
  }, [current]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  // Rarity vocabulary is per-franchise (see lib/rarity.ts) - switching
  // franchise resets the rarity choice if it doesn't exist in the new
  // franchise's list, so the form never holds an invalid combination.
  const handleFranchiseChange = (franchise: string) => {
    setForm((f) => ({
      ...f,
      franchise,
      rarity: raritiesForFranchise(franchise).includes(f.rarity) ? f.rarity : DEFAULT_RARITY,
      pokemonType: franchise === "pokemon" ? (f.pokemonType ?? POKEMON_TYPES[0]) : null,
    }));
  };

  const zoomIndex = ZOOM_STEPS.indexOf(zoom);
  const zoomIn = () => setZoom(ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, zoomIndex + 1)]);
  const zoomOut = () => setZoom(ZOOM_STEPS[Math.max(0, zoomIndex - 1)]);

  const handleSave = (e: FormEvent) => {
    e.preventDefault();
    if (!current || saving) return;

    const price = Number(form.price);
    if (!form.title.trim() || !form.setName.trim() || !price || price <= 0) {
      setError("Fill in card name, set, and a price above ₱0 before saving.");
      return;
    }

    const conditionGrade = form.cardType === "RAW" ? `Raw ${form.condition}` : `${form.grader} ${form.gradeNumber}`;
    const quantity = Math.max(1, Math.round(Number(form.quantity)) || 1);

    setError(null);
    setSaving(true);
    updateCard(current.id, {
      title: form.title.trim(),
      setName: form.setName.trim(),
      price,
      conditionGrade,
      rarity: form.rarity,
      pokemonType: form.franchise === "pokemon" ? form.pokemonType : null,
      // Rapid Fill is scoped to individual cards only (see the file's own
      // doc comment) - sealed products go through the regular Add Listing
      // form instead.
      productType: "CARD",
      sealedType: null,
      images: current.images,
      sellerHandle: current.sellerHandle,
      sellerMessenger: current.sellerMessenger,
      isFlashSale: current.isFlashSale,
      isNegotiable: current.isNegotiable,
      franchise: form.franchise,
      quantity,
    })
      .then(() => {
        setCompleted((prev) => new Set(prev).add(current.id));
        setQueue((prev) =>
          prev.map((c) =>
            c.id === current.id
              ? {
                  ...c,
                  title: form.title.trim(),
                  setName: form.setName.trim(),
                  price,
                  conditionGrade,
                  rarity: form.rarity,
                  pokemonType: form.franchise === "pokemon" ? form.pokemonType : null,
                  franchise: form.franchise,
                  quantity,
                  quantityAvailable: quantity,
                }
              : c,
          ),
        );
        const hasNext = currentIndex < queue.length - 1;
        const savedTitle = form.title.trim();
        setNotice(
          hasNext
            ? `Saved "${savedTitle}" - here's the next card.`
            : `Saved "${savedTitle}" - that was the last card. Tap Publish All Completed to put them live.`,
        );
        setTimeout(() => setNotice(null), 5000);
        if (hasNext) {
          setCurrentIndex((i) => i + 1);
        } else {
          revealTop();
        }
      })
      .catch((err) => setError(extractErrorMessage(err) ?? "Failed to save"))
      .finally(() => setSaving(false));
  };

  const handleDiscard = async () => {
    if (!current) return;
    const confirmed = await confirm({
      title: "Discard photo",
      message: "Discard this photo? This can't be undone.",
      confirmLabel: "Discard",
      tone: "danger",
    });
    if (!confirmed) return;
    deleteCard(current.id)
      .then(() => {
        setQueue((prev) => prev.filter((c) => c.id !== current.id));
        setCompleted((prev) => {
          const next = new Set(prev);
          next.delete(current.id);
          return next;
        });
        // Discarding always removes the current index specifically, so
        // staying at the same numeric index naturally shows what was next
        // (the array shifts under it) - only clamp down if we discarded the
        // last item in the queue.
        setCurrentIndex((i) => Math.min(i, Math.max(0, queue.length - 2)));
      })
      .catch((err) => setError(extractErrorMessage(err) ?? "Failed to discard"));
  };

  const goPrev = () => setCurrentIndex((i) => Math.max(0, i - 1));
  const goNext = () => setCurrentIndex((i) => Math.min(queue.length - 1, i + 1));

  const handlePublish = () => {
    if (completed.size === 0) return;
    setPublishing(true);
    setError(null);
    publishDrafts(Array.from(completed))
      .then(() => router.push("/admin/inventory"))
      .catch((err) => {
        setError(extractErrorMessage(err) ?? "Failed to publish");
        setPublishing(false);
      });
  };

  if (queue.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-card-border py-24 text-center">
        <CheckCircle2 size={28} className="text-available" />
        <p className="text-sm text-foreground-muted">No drafts left in this batch.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div ref={topRef} className="scroll-mt-[calc(var(--header-height)+0.5rem)] space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={goPrev} disabled={currentIndex === 0 || saving} className="px-2 py-1.5" aria-label="Previous card">
              <ChevronLeft size={16} />
            </Button>
            <p className="text-sm font-medium text-foreground-muted">
              Card {currentIndex + 1} of {queue.length} &middot; {completed.size} saved
            </p>
            <Button type="button" variant="outline" onClick={goNext} disabled={currentIndex >= queue.length - 1 || saving} className="px-2 py-1.5" aria-label="Skip to next card">
              <ChevronRight size={16} />
            </Button>
          </div>
          <Button variant="gold" disabled={completed.size === 0 || publishing} onClick={handlePublish}>
            <CheckCircle2 size={15} />
            {publishing ? "Publishing..." : `Publish All Completed (${completed.size})`}
          </Button>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-foreground/10">
          <div className="h-full rounded-full bg-gold transition-all" style={{ width: `${(completed.size / queue.length) * 100}%` }} />
        </div>
        {notice && (
          <p role="status" className="rounded-lg bg-available-bg px-3 py-2 text-sm font-medium text-available">
            {notice}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="min-w-0 space-y-2">
          <div className="relative mx-auto h-[min(60vh,28rem)] w-full max-w-md overflow-auto rounded-2xl border border-card-border bg-navy-950/5">
            {current?.images[0] ? (
              <>
                {!imageLoaded && (
                  <div className="absolute inset-0 z-10 flex items-center justify-center bg-card/80 text-sm text-foreground-muted">
                    <span className="animate-pulse">Loading photo...</span>
                  </div>
                )}
                {/* key remounts the <img> per card, so the previous card's photo is never left showing while the next downloads. */}
                {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary seller-supplied image URL, zoomable so plain img (not next/image) keeps this simple */}
                <img
                  key={current.id}
                  src={current.images[0]}
                  alt={current.title}
                  onLoad={() => setLoadedImageId(current.id)}
                  ref={(el) => {
                    if (el?.complete && el.naturalWidth > 0) setLoadedImageId(current.id);
                  }}
                  // Percent of the panel (not a fixed pixel width) so a phone's
                  // narrower panel never gets a wider-than-screen photo; zoom
                  // scales it up inside the scrollable box.
                  style={{ width: `${zoom * 100}%` }}
                  className="h-auto max-w-none"
                />
              </>
            ) : (
              <div className="flex h-full w-full items-center justify-center text-foreground-muted">
                <ImageOff size={32} />
              </div>
            )}
          </div>
          <div className="flex items-center justify-center gap-2">
            <Button type="button" variant="outline" onClick={zoomOut} disabled={zoomIndex <= 0}>
              <Minus size={14} />
            </Button>
            <span className="w-12 text-center text-sm text-foreground-muted">{Math.round(zoom * 100)}%</span>
            <Button type="button" variant="outline" onClick={zoomIn} disabled={zoomIndex >= ZOOM_STEPS.length - 1}>
              <Plus size={14} />
            </Button>
            <Button type="button" variant="outline" onClick={() => setZoom(1)} disabled={zoom === 1}>
              <RotateCcw size={14} />
            </Button>
          </div>
        </div>

        <form onSubmit={handleSave} className="grid min-w-0 grid-cols-1 gap-3 rounded-2xl border border-card-border bg-card p-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-foreground-muted">
              Card Name *
            </label>
            <Input
              ref={titleRef}
              autoFocus
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
              onFocus={(e) => e.target.select()}
              required
            />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-foreground-muted">
              Set Name *
            </label>
            <Input
              value={form.setName}
              onChange={(e) => set("setName", e.target.value)}
              onFocus={(e) => e.target.select()}
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-foreground-muted">
              Franchise *
            </label>
            <Select value={form.franchise} onChange={(e) => handleFranchiseChange(e.target.value)}>
              {FRANCHISES.map((f) => (
                <option key={f.slug} value={f.slug}>
                  {f.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-foreground-muted">
              Rarity *
            </label>
            <Select value={form.rarity} onChange={(e) => set("rarity", e.target.value)}>
              {raritiesForFranchise(form.franchise).map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          </div>
          {form.franchise === "pokemon" && (
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-foreground-muted">
                Type *
              </label>
              <Select value={form.pokemonType ?? POKEMON_TYPES[0]} onChange={(e) => set("pokemonType", e.target.value)}>
                {POKEMON_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-foreground-muted">
              Price (₱) *
            </label>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={form.price}
              onChange={(e) => set("price", e.target.value)}
              onFocus={(e) => e.target.select()}
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-foreground-muted">
              Quantity *
            </label>
            <Input
              type="number"
              min={1}
              step="1"
              value={form.quantity}
              onChange={(e) => set("quantity", e.target.value)}
              onFocus={(e) => e.target.select()}
              required
            />
          </div>

          <div className="sm:col-span-2">
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
          </div>

          {form.cardType === "RAW" ? (
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-foreground-muted">
                Condition *
              </label>
              <Select value={form.condition} onChange={(e) => set("condition", e.target.value as ConditionCode)}>
                {Object.entries(CONDITION_LABELS).map(([code, label]) => (
                  <option key={code} value={code}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>
          ) : (
            <>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-foreground-muted">
                  Grader *
                </label>
                <Select value={form.grader} onChange={(e) => set("grader", e.target.value)}>
                  {GRADERS.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-foreground-muted">
                  Grade *
                </label>
                <Select value={form.gradeNumber} onChange={(e) => set("gradeNumber", e.target.value)}>
                  {GRADE_NUMBERS.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </Select>
              </div>
            </>
          )}

          {error && <p className="text-sm text-sold sm:col-span-2">{error}</p>}

          <div className="flex items-center gap-2 sm:col-span-2">
            <Button type="submit" variant="gold" disabled={saving} className="flex-1">
              {saving ? "Saving..." : "Save & Next (Enter)"}
            </Button>
            <Button type="button" variant="danger" onClick={handleDiscard} disabled={saving}>
              <Trash2 size={14} />
              Discard
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
