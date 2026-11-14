"use client";

import { FocusEvent, KeyboardEvent, Ref, useEffect, useId, useRef, useState } from "react";
import { Input } from "@/components/ui/Input";
import { CATALOG_MAX_RESULTS, CatalogCard, catalogImageUrl } from "@/lib/pokemonCatalog";

interface Props {
  value: string;
  /** The box was typed in (not a pick). */
  onValueChange: (value: string) => void;
  /** A suggestion was chosen with Enter or a click. */
  onPick: (card: CatalogCard) => void;
  search: (query: string) => Promise<{ cards: CatalogCard[] }>;
  inputRef?: Ref<HTMLInputElement>;
  placeholder?: string;
  maxLength?: number;
  required?: boolean;
  autoFocus?: boolean;
  onFocus?: (e: FocusEvent<HTMLInputElement>) => void;
}

/**
 * A text box that suggests cards from a shared catalog (Pokemon or One Piece, whichever `search` reads) while typing. Enter / click pick a match;
 * Tab and Escape leave whatever was typed as it is, so custom items always work.
 */
export function CatalogPicker({ value, onValueChange, onPick, search, inputRef, placeholder, maxLength = 200, required, autoFocus, onFocus }: Props) {
  const [matches, setMatches] = useState<CatalogCard[]>([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);
  const listId = useId();

  // With dozens of matches the highlighted one (arrow keys) has to stay in view.
  useEffect(() => {
    if (open) document.getElementById(`${listId}-${highlight}`)?.scrollIntoView({ block: "nearest" });
  }, [highlight, open, listId]);

  const change = (next: string) => {
    onValueChange(next);
    setOpen(true);
    setHighlight(0);
    if (timer.current) clearTimeout(timer.current);
    const mine = ++seq.current;
    if (next.trim().length < 2) {
      setMatches([]);
      return;
    }
    // Wait for a pause in typing, and ignore answers that arrive after the box has changed again.
    timer.current = setTimeout(async () => {
      try {
        const result = await search(next);
        if (mine === seq.current) setMatches(result.cards);
      } catch {
        if (mine === seq.current) setMatches([]);
      }
    }, 250);
  };

  const pick = (card: CatalogCard) => {
    if (timer.current) clearTimeout(timer.current);
    seq.current++;
    setMatches([]);
    setOpen(false);
    onPick(card);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!open || matches.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => (h + 1) % matches.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => (h - 1 + matches.length) % matches.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(matches[Math.min(highlight, matches.length - 1)]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className="relative">
      <Input
        ref={inputRef}
        value={value}
        onChange={(e) => change(e.target.value)}
        onFocus={(e) => {
          setOpen(true);
          onFocus?.(e);
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={open && matches.length > 0}
        aria-autocomplete="list"
        maxLength={maxLength}
        required={required}
        autoFocus={autoFocus}
      />
      {open && matches.length > 0 && (
        <ul role="listbox" className="absolute left-0 right-0 top-full z-20 mt-1 max-h-128 overflow-auto rounded-lg border border-card-border bg-background-elevated shadow-xl">
          {matches.map((c, i) => {
            const img = catalogImageUrl(c.image);
            return (
              <li
                key={c.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === highlight}
                // mousedown (not click) so it fires before the input's blur closes the list.
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(c);
                }}
                onMouseEnter={() => setHighlight(i)}
                className={`flex cursor-pointer items-center gap-3 px-3 py-2 text-sm ${i === highlight ? "bg-gold/15" : ""}`}
              >
                {img ? (
                  // eslint-disable-next-line @next/next/no-img-element -- small catalog picture from the TCGdex image host
                  <img src={img} alt="" loading="lazy" className="h-20 w-14 shrink-0 rounded object-cover" />
                ) : (
                  <span className="flex h-20 w-14 shrink-0 items-center justify-center rounded bg-foreground/5 px-1 text-center text-[10px] leading-tight text-foreground-muted">no picture</span>
                )}
                <span className="min-w-0">
                  <span className="block truncate font-medium">
                    {c.name}
                    {c.variant && <span className="ml-1.5 rounded bg-gold/15 px-1 py-px align-middle text-[10px] font-semibold text-gold-ink">{c.variant}</span>}
                    {c.lang === "ja" && <span className="ml-1.5 rounded bg-foreground/10 px-1 py-px align-middle text-[10px] font-semibold text-foreground-muted">JP</span>}
                  </span>
                  <span className="block truncate text-xs text-foreground-muted">
                    {c.setName} · #{c.number}
                    {c.year ? ` · ${c.year}` : ""}
                  </span>
                </span>
              </li>
            );
          })}
          {matches.length >= CATALOG_MAX_RESULTS && (
            <li role="presentation" className="px-3 py-2 text-xs text-foreground-muted">
              Showing the first {CATALOG_MAX_RESULTS} matches. Add a set name or number to narrow it - the oldest printings are at the bottom.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
