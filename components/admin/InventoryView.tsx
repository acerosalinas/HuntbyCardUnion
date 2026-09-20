"use client";

import { useMemo, useState, useTransition } from "react";
import { LayoutGrid, List, PackageX, Pencil, Search, Trash2 } from "lucide-react";
import { InventoryList } from "@/components/admin/InventoryList";
import { InventoryGrid } from "@/components/admin/InventoryGrid";
import { BulkEditModal } from "@/components/admin/BulkEditModal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { sortSoldLast } from "@/lib/cardFilter";
import { cn, extractErrorMessage } from "@/lib/utils";
import { CardItem } from "@/types/marketplace";
import { deleteCards } from "@/app/admin/actions";

type View = "list" | "tiles";

/** List/Tiles toggle + search for an admin's (or super admin's) own stock - same underlying cards, two layouts. Tick listings (or "Select all") to remove or edit many at once. */
export function InventoryView({ cards }: { cards: CardItem[] }) {
  const [view, setView] = useState<View>("tiles");
  const [query, setQuery] = useState("");
  const [soldOnly, setSoldOnly] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editOpen, setEditOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const confirm = useConfirm();
  const soldCount = useMemo(() => cards.filter((c) => c.status === "SOLD").length, [cards]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let result = cards;
    if (soldOnly) result = result.filter((c) => c.status === "SOLD");
    if (q) result = result.filter((c) => c.title.toLowerCase().includes(q) || c.setName.toLowerCase().includes(q));
    // Sold-out stock sinks to the end even with the filter off, instead of
    // being interspersed among what's still actually sellable.
    return sortSoldLast(result);
  }, [cards, query, soldOnly]);

  // Only ever act on what's currently visible AND still exists - a selection
  // left over from before a search/filter change or a removal never sneaks
  // into a bulk action.
  const selectedCards = useMemo(() => filtered.filter((c) => selectedIds.has(c.id)), [filtered, selectedIds]);
  const allSelected = filtered.length > 0 && selectedCards.length === filtered.length;

  const toggleOne = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () => setSelectedIds(allSelected ? new Set() : new Set(filtered.map((c) => c.id)));
  const clearSelection = () => setSelectedIds(new Set());

  const handleRemoveSelected = async () => {
    const count = selectedCards.length;
    const withSales = selectedCards.filter((c) => c.quantity > c.quantityAvailable).length;
    const confirmed = await confirm({
      title: `Remove ${count} listing${count === 1 ? "" : "s"}`,
      message: (
        <div className="space-y-2">
          <p>
            Remove {count} selected listing{count === 1 ? "" : "s"}? This can&apos;t be undone.
          </p>
          {withSales > 0 && (
            <p className="text-pending">
              {withSales} of these {withSales === 1 ? "has" : "have"} sales on record - removing {withSales === 1 ? "it also deletes" : "them also deletes"} that sale history from your Sales Log.
            </p>
          )}
        </div>
      ),
      confirmLabel: `Remove ${count}`,
      tone: "danger",
    });
    if (!confirmed) return;

    setError(null);
    setNotice(null);
    startTransition(async () => {
      try {
        const result = await deleteCards(selectedCards.map((c) => c.id));
        clearSelection();
        setNotice(`Removed ${result.removed} listing${result.removed === 1 ? "" : "s"}.`);
      } catch (err) {
        setError(extractErrorMessage(err) ?? "Failed to remove listings");
      }
    });
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="relative w-full max-w-xs">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-foreground-muted" />
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              clearSelection();
            }}
            placeholder="Search by title or set..."
            className="pl-8"
          />
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              setSoldOnly((v) => !v);
              clearSelection();
            }}
            disabled={soldCount === 0}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
              soldOnly
                ? "border-gold bg-gold text-navy-950"
                : "border-card-border text-foreground-muted hover:border-gold/50 hover:text-foreground",
            )}
          >
            <PackageX size={14} />
            Sold Out ({soldCount})
          </button>
          {([
            { key: "list" as const, label: "List", icon: List },
            { key: "tiles" as const, label: "Tiles", icon: LayoutGrid },
          ]).map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setView(key)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors",
                view === key
                  ? "border-gold bg-gold text-navy-950"
                  : "border-card-border text-foreground-muted hover:border-gold/50 hover:text-foreground",
              )}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>
      </div>

      {query && (
        <p className="mb-2 text-xs text-foreground-muted">
          {filtered.length} of {cards.length} card{cards.length === 1 ? "" : "s"} match &quot;{query}&quot;
        </p>
      )}

      {filtered.length > 0 && (
        <div
          className={cn(
            "mb-3 flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2",
            selectedCards.length > 0 ? "border-gold/60 bg-gold/10" : "border-card-border",
          )}
        >
          <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              className="h-4 w-4 rounded border-card-border accent-gold"
            />
            Select all ({filtered.length})
          </label>
          {selectedCards.length > 0 && (
            <>
              <span className="text-sm font-medium text-foreground">{selectedCards.length} selected</span>
              <button type="button" onClick={clearSelection} className="text-xs text-foreground-muted underline hover:text-foreground">
                Clear
              </button>
              <div className="ml-auto flex gap-2">
                <Button variant="outline" disabled={pending} onClick={() => setEditOpen(true)} className="px-3 py-1.5 text-xs">
                  <Pencil size={13} />
                  Edit selected
                </Button>
                <Button variant="danger" disabled={pending} onClick={handleRemoveSelected} className="px-3 py-1.5 text-xs">
                  <Trash2 size={13} />
                  {pending ? "Removing..." : "Remove selected"}
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {error && <p className="mb-3 text-sm text-sold">{error}</p>}
      {notice && <p className="mb-3 text-sm text-available">{notice}</p>}

      {view === "list" ? (
        <InventoryList cards={filtered} selectedIds={selectedIds} onToggle={toggleOne} />
      ) : (
        <InventoryGrid cards={filtered} selectedIds={selectedIds} onToggle={toggleOne} />
      )}

      <BulkEditModal
        open={editOpen}
        cardIds={selectedCards.map((c) => c.id)}
        onClose={() => setEditOpen(false)}
        onDone={(updated) => {
          setEditOpen(false);
          clearSelection();
          setError(null);
          setNotice(`Updated ${updated} listing${updated === 1 ? "" : "s"}.`);
        }}
      />
    </div>
  );
}
