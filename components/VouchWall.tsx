"use client";

import { CSSProperties, FormEvent, useMemo, useState } from "react";
import { ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Input";
import { StarRating } from "@/components/ui/StarRating";
import { useBuyerIdentity } from "@/components/BuyerIdentityProvider";
import { createClient } from "@/lib/supabase/client";
import { cn, extractErrorMessage, formatRelativeTime } from "@/lib/utils";
import { Vouch, VouchRow, vouchFromRow } from "@/types/marketplace";

const MAX_LENGTH = 280;
// Below this the drifting rows look empty and lonely, so a few vouches just sit still in a row.
const MARQUEE_MIN = 4;
// Two rows (drifting in opposite directions) once there is enough to fill them.
const TWO_ROWS_MIN = 10;

function VouchCard({ vouch, mine, onDelete, deleting }: { vouch: Vouch; mine: boolean; onDelete: () => void; deleting: boolean }) {
  const initial = vouch.buyerHandle.replace(/^@/, "").charAt(0).toUpperCase() || "?";
  return (
    <li className="group/vouch relative flex w-72 shrink-0 flex-col gap-2.5 rounded-2xl border border-card-border bg-card p-4 sm:w-80">
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden="true"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-gold/60 bg-navy-950 font-display text-sm font-semibold text-gold"
        >
          {initial}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{vouch.buyerHandle}</p>
          <p suppressHydrationWarning className="text-xs text-foreground-muted">
            {formatRelativeTime(vouch.createdAt)}
          </p>
        </div>
        {vouch.rating !== null && <StarRating value={vouch.rating} readOnly size={13} />}
      </div>
      <p className="line-clamp-4 text-sm leading-relaxed text-foreground-muted">{vouch.message}</p>
      {mine && (
        <button
          type="button"
          onClick={onDelete}
          disabled={deleting}
          aria-label="Delete your vouch"
          className="absolute bottom-2 right-2 rounded-full p-2 text-foreground-muted opacity-60 transition hover:bg-foreground/10 hover:text-sold hover:opacity-100 focus-visible:opacity-100 disabled:opacity-30"
        >
          <Trash2 size={14} />
        </button>
      )}
    </li>
  );
}

function Row({
  vouches,
  userId,
  reverse,
  animate,
  deletingId,
  onDelete,
}: {
  vouches: Vouch[];
  userId: string | null;
  reverse?: boolean;
  animate: boolean;
  deletingId: string | null;
  onDelete: (id: string) => void;
}) {
  const list = (dup: boolean) => (
    <ul
      className="flex shrink-0 gap-4 pr-4"
      // The second copy only exists to make the loop seamless; keep it out of the accessibility tree and the tab order.
      {...(dup ? { "aria-hidden": true, "data-dup": "", inert: true } : {})}
    >
      {vouches.map((v) => (
        <VouchCard key={v.id} vouch={v} mine={v.buyerId === userId} deleting={deletingId === v.id} onDelete={() => onDelete(v.id)} />
      ))}
    </ul>
  );

  if (!animate) {
    return <ul className="flex flex-wrap justify-center gap-4">{vouches.map((v) => (
      <VouchCard key={v.id} vouch={v} mine={v.buyerId === userId} deleting={deletingId === v.id} onDelete={() => onDelete(v.id)} />
    ))}</ul>;
  }

  // ~7s per card keeps the drift slow enough to read.
  const style = { "--vouch-duration": `${Math.max(40, vouches.length * 7)}s` } as CSSProperties;
  return (
    <div className="vouch-marquee">
      <div className="vouch-track" style={style} {...(reverse ? { "data-reverse": "" } : {})}>
        {list(false)}
        {list(true)}
      </div>
    </div>
  );
}

export function VouchWall({ initialVouches }: { initialVouches: Vouch[] }) {
  const { buyer, resolved } = useBuyerIdentity();
  const [vouches, setVouches] = useState(initialVouches);
  const [message, setMessage] = useState("");
  const [rating, setRating] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rated = vouches.filter((v) => v.rating !== null);
  const average = rated.length ? rated.reduce((n, v) => n + (v.rating ?? 0), 0) / rated.length : null;

  const animate = vouches.length >= MARQUEE_MIN;
  const rows = useMemo(() => {
    if (!animate || vouches.length < TWO_ROWS_MIN) return [vouches];
    // Alternate cards so both rows hold a mix of old and new.
    return [vouches.filter((_, i) => i % 2 === 0), vouches.filter((_, i) => i % 2 === 1)];
  }, [vouches, animate]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!buyer || submitting) return;
    const text = message.trim();
    if (text.length < 3) {
      setError("Write at least a few words.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const { data, error: insertError } = await createClient()
        .from("vouches")
        .insert({ buyer_id: buyer.id, message: text, rating: rating > 0 ? rating : null })
        .select("*")
        .single();
      if (insertError) {
        if (/vouches|schema cache|does not exist/i.test(insertError.message) && !/row-level/i.test(insertError.message)) {
          setError("Vouches aren't switched on yet. An admin needs to run the vouches migration first.");
        } else if (/row-level security/i.test(insertError.message)) {
          setError("You can leave up to 3 vouches a day, and only from an approved account.");
        } else {
          setError(extractErrorMessage(insertError));
        }
        return;
      }
      setVouches((prev) => [vouchFromRow(data as VouchRow), ...prev]);
      setMessage("");
      setRating(0);
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (id: string) => {
    setDeletingId(id);
    const { error: deleteError } = await createClient().from("vouches").delete().eq("id", id);
    setDeletingId(null);
    if (deleteError) {
      setError(extractErrorMessage(deleteError));
      return;
    }
    setVouches((prev) => prev.filter((v) => v.id !== id));
  };

  return (
    <section aria-labelledby="vouch-heading" className="mx-auto w-full max-w-6xl px-4 py-10 sm:py-12">
      <div className="mb-6 flex flex-col items-center gap-2 text-center">
        <ShieldCheck size={22} className="text-gold" aria-hidden="true" />
        <h2 id="vouch-heading" className="font-display text-2xl font-medium text-foreground sm:text-3xl">
          Vouches from our members
        </h2>
        <p className="max-w-md text-sm text-foreground-muted">
          Real words from approved members about buying here. Bought something? Leave yours.
        </p>
        {vouches.length > 0 && (
          <div className="flex items-center gap-2 text-sm text-foreground-muted">
            {average !== null && (
              <>
                <StarRating value={average} readOnly size={14} />
                <span className="font-semibold tabular-nums text-foreground">{average.toFixed(1)}</span>
                <span aria-hidden="true">·</span>
              </>
            )}
            <span className="tabular-nums">
              {vouches.length} vouch{vouches.length === 1 ? "" : "es"}
            </span>
          </div>
        )}
      </div>

      {vouches.length === 0 ? (
        <div className="mx-auto flex max-w-md flex-col items-center rounded-2xl border border-dashed border-card-border px-6 py-10 text-center">
          <p className="text-sm text-foreground-muted">No vouches yet. Be the first to say how it went.</p>
        </div>
      ) : (
        <div role="region" aria-label="Member vouches" className="flex flex-col gap-4">
          {rows.map((row, i) => (
            <Row key={i} vouches={row} userId={buyer?.id ?? null} reverse={i === 1} animate={animate} deletingId={deletingId} onDelete={remove} />
          ))}
        </div>
      )}

      {resolved && buyer && (
        <form onSubmit={submit} className="mx-auto mt-8 flex w-full max-w-xl flex-col gap-3 rounded-2xl border border-card-border bg-card p-4 sm:p-5">
          <label htmlFor="vouch-message" className="text-sm font-semibold text-foreground">
            Leave a vouch as {buyer.handle}
          </label>
          <Textarea
            id="vouch-message"
            rows={3}
            maxLength={MAX_LENGTH}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="How did your purchase go? Card condition, packaging, how fast the seller replied…"
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <StarRating value={rating} onChange={setRating} size={22} />
              <span className="text-xs text-foreground-muted">optional</span>
            </div>
            <div className="flex items-center gap-3">
              <span className={cn("text-xs tabular-nums", message.length > MAX_LENGTH - 20 ? "text-pending" : "text-foreground-muted")}>
                {message.length}/{MAX_LENGTH}
              </span>
              <Button type="submit" variant="gold" disabled={submitting || message.trim().length < 3}>
                {submitting ? "Posting…" : "Post vouch"}
              </Button>
            </div>
          </div>
          {error && (
            <p role="alert" className="text-sm text-sold">
              {error}
            </p>
          )}
        </form>
      )}
    </section>
  );
}
