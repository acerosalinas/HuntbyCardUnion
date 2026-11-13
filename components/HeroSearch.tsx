"use client";

import { KeyboardEvent, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ImageOff, Search } from "lucide-react";
import { useHomeCards } from "@/components/HomeCardsProvider";
import { useMarketplaceFilter } from "@/components/MarketplaceFilterProvider";
import { suggestCards } from "@/lib/homeFilters";
import { cn, formatCurrency } from "@/lib/utils";

/**
 * The home page's search: type a card name and the best matches appear under the box, so a shopper can go straight to a card. Enter with nothing
 * highlighted carries the search over to the full marketplace. Suggestions come from the same live list as the shelf, so it answers instantly and
 * never offers a card that has just sold.
 */
export function HeroSearch() {
  const all = useHomeCards();
  const cards = useMemo(() => all.filter((c) => c.status === "AVAILABLE" || c.status === "PENDING"), [all]);
  const router = useRouter();
  const { setQuery: setMarketplaceQuery } = useMarketplaceFilter();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);

  const suggestions = useMemo(() => suggestCards(cards, value, 6), [cards, value]);
  const showList = open && value.trim().length >= 2;

  const goToMarketplace = () => {
    setMarketplaceQuery(value.trim());
    router.push("/marketplace");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(suggestions.length - 1, h + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(-1, h - 1));
    } else if (e.key === "Escape") {
      setOpen(false);
      setHighlight(-1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (highlight >= 0 && suggestions[highlight]) router.push(`/card/${suggestions[highlight].id}`);
      else if (value.trim()) goToMarketplace();
    }
  };

  return (
    <div className="relative mb-5 w-full max-w-xl">
      <label htmlFor={`${listId}-input`} className="sr-only">
        Search cards
      </label>
      <div className="relative">
        <Search size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-foreground-muted" aria-hidden="true" />
        <input
          ref={inputRef}
          id={`${listId}-input`}
          type="search"
          role="combobox"
          aria-expanded={showList && suggestions.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={highlight >= 0 ? `${listId}-${highlight}` : undefined}
          autoComplete="off"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setOpen(true);
            setHighlight(-1);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          placeholder="Search a card, set or seller"
          className="w-full rounded-full border border-card-border bg-card py-3.5 pl-11 pr-4 text-base text-foreground shadow-sm outline-none transition-colors placeholder:text-foreground-muted focus:border-gold focus:ring-2 focus:ring-gold/25"
        />
      </div>

      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Matching cards"
          className="absolute left-0 right-0 top-full z-30 mt-2 overflow-hidden rounded-2xl border border-card-border bg-background-elevated shadow-2xl"
        >
          {suggestions.length === 0 ? (
            <li role="presentation" className="px-4 py-3 text-sm text-foreground-muted">
              Nothing matches &ldquo;{value.trim()}&rdquo; yet.{" "}
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={goToMarketplace} className="font-medium text-gold-ink underline underline-offset-2">
                Search the whole marketplace
              </button>
            </li>
          ) : (
            suggestions.map((card, i) => (
              <li
                key={card.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === highlight}
                // mousedown, not click: it fires before the input's blur closes the list.
                onMouseDown={(e) => {
                  e.preventDefault();
                  router.push(`/card/${card.id}`);
                }}
                onMouseEnter={() => setHighlight(i)}
                className={cn("flex cursor-pointer items-center gap-3 px-3 py-2", i === highlight ? "bg-gold/15" : "hover:bg-foreground/5")}
              >
                <span className="flex h-12 w-9 shrink-0 items-center justify-center overflow-hidden rounded border border-card-border bg-navy-950/5">
                  {card.images[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element -- arbitrary seller-supplied image URLs, not local assets
                    <img src={card.images[0]} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <ImageOff size={14} className="text-foreground-muted" aria-hidden="true" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">{card.title}</span>
                  <span className="block truncate text-xs text-foreground-muted">{card.sellerHandle}</span>
                </span>
                <span className="shrink-0 text-sm font-bold tabular-nums text-gold-ink">{formatCurrency(card.price)}</span>
              </li>
            ))
          )}
          {suggestions.length > 0 && (
            <li role="presentation" className="border-t border-card-border">
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={goToMarketplace} className="w-full px-4 py-2.5 text-left text-xs font-medium text-foreground-muted hover:text-foreground">
                See every result for &ldquo;{value.trim()}&rdquo; in the marketplace
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
