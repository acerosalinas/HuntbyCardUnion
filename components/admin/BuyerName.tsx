"use client";

import { FormEvent, useState, useTransition } from "react";
import { Check, Pencil, X } from "lucide-react";
import { setBuyerAlias } from "@/app/admin/aliasActions";
import { ALIAS_MAX_LENGTH, BuyerAliasInfo } from "@/lib/buyerAlias";

/**
 * A customer's @handle with this admin's own sub username beside it, and a pencil to set or change it. Admin screens only: the label is
 * private to the admin who wrote it. Without the account id (a customer who no longer has an account) it just shows the handle.
 */
export function BuyerName({ handle, info, className }: { handle: string; info?: BuyerAliasInfo | null; className?: string }) {
  const [alias, setAlias] = useState<string | null>(info?.alias ?? null);
  // Follow the server when the page refreshes with a new value.
  const [seen, setSeen] = useState<string | null>(info?.alias ?? null);
  if ((info?.alias ?? null) !== seen) {
    setSeen(info?.alias ?? null);
    setAlias(info?.alias ?? null);
  }
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const buyerId = info?.buyerId ?? null;

  const save = (e: FormEvent) => {
    e.preventDefault();
    if (!buyerId) return;
    startTransition(async () => {
      setError(null);
      const result = await setBuyerAlias(buyerId, text);
      if (result.error) return setError(result.error);
      setAlias(result.alias ?? null);
      setEditing(false);
    });
  };

  if (editing && buyerId) {
    return (
      <form onSubmit={save} className="inline-flex flex-wrap items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
        <span className="font-semibold text-foreground">{handle}</span>
        <input
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={ALIAS_MAX_LENGTH}
          placeholder="Sub username (only you see it)"
          aria-label={`Sub username for ${handle}`}
          className="w-44 rounded-md border border-card-border bg-background-elevated px-2 py-1 text-base outline-none focus:border-gold sm:text-xs"
        />
        <button type="submit" disabled={pending} aria-label="Save sub username" className="rounded-md p-1 text-available hover:bg-available/10 disabled:opacity-50">
          <Check size={14} />
        </button>
        <button type="button" onClick={() => setEditing(false)} aria-label="Cancel" className="rounded-md p-1 text-foreground-muted hover:bg-foreground/10">
          <X size={14} />
        </button>
        {error && <span className="basis-full text-xs text-sold">{error}</span>}
      </form>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className={className ?? "font-semibold text-foreground"}>{handle}</span>
      {alias && <span className="rounded-full bg-gold/15 px-2 py-0.5 text-xs font-medium text-gold-ink" title="Your private sub username for this customer">{alias}</span>}
      {buyerId && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setText(alias ?? "");
            setError(null);
            setEditing(true);
          }}
          aria-label={alias ? `Change your sub username for ${handle}` : `Add a sub username for ${handle}`}
          title={alias ? "Change sub username" : "Add a sub username (only you see it)"}
          className="rounded-md p-1 text-foreground-muted transition-colors hover:bg-foreground/10 hover:text-foreground"
        >
          <Pencil size={12} />
        </button>
      )}
    </span>
  );
}
