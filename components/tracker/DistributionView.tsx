"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { Package, Search, Truck, Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { ShipDialog } from "@/components/tracker/ShipDialog";
import { setSalesDistributed, undoShipment } from "@/app/tracker/actions";
import { CustomerTotals } from "@/lib/tracker/money";
import { ownerColor } from "@/lib/tracker/ownerColors";
import { ISLAND_GROUP_LABELS } from "@/lib/tracker/regions";
import type { TrackerCustomer, TrackerLive, TrackerSale, TrackerSettings, TrackerShipment } from "@/lib/tracker/data";
import { cn, extractErrorMessage, formatCurrency } from "@/lib/utils";

type Status = "TODO" | "DONE" | "ALL";

interface Props {
  customers: TrackerCustomer[];
  lives: TrackerLive[];
  sales: TrackerSale[];
  shipments: TrackerShipment[];
  totalsByCustomer: Record<string, CustomerTotals>;
  settings: TrackerSettings;
}

/** A card is "done" once it's been handed over (not shipping) or put in a parcel (shipping). */
const isDone = (s: TrackerSale) => (s.forShipping ? s.shipmentId !== null : s.distributedAt !== null);

export function DistributionView({ customers, lives, sales, shipments, totalsByCustomer, settings }: Props) {
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("TODO");
  const [liveFilter, setLiveFilter] = useState("ALL");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [shipping, setShipping] = useState<{ customerId: string; saleIds: string[] } | null>(null);

  const customerById = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);
  const liveById = useMemo(() => new Map(lives.map((l) => [l.id, l])), [lives]);
  const shipmentById = useMemo(() => new Map(shipments.map((s) => [s.id, s])), [shipments]);

  const inScope = useMemo(
    () => sales.filter((s) => (liveFilter === "ALL" ? true : s.liveId === liveFilter)),
    [sales, liveFilter],
  );
  const todo = inScope.filter((s) => !isDone(s)).length;
  const done = inScope.length - todo;

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const map = new Map<string, TrackerSale[]>();
    for (const s of inScope) {
      if (status === "TODO" && isDone(s)) continue;
      if (status === "DONE" && !isDone(s)) continue;
      const name = customerById.get(s.customerId)?.name ?? "";
      if (q && !name.toLowerCase().includes(q) && !s.cardName.toLowerCase().includes(q)) continue;
      map.set(s.customerId, [...(map.get(s.customerId) ?? []), s]);
    }
    return [...map.entries()]
      .map(([customerId, items]) => ({ customerId, name: customerById.get(customerId)?.name ?? "Customer", items }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [inScope, status, query, customerById]);

  const run = (fn: () => Promise<void>) => {
    setError(null);
    startTransition(async () => {
      try {
        await fn();
      } catch (err) {
        setError(extractErrorMessage(err) ?? "Something went wrong.");
      }
    });
  };

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const setMany = (ids: string[], on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  const undoParcel = async (sale: TrackerSale) => {
    if (!sale.shipmentId) return;
    const parcelCards = sales.filter((s) => s.shipmentId === sale.shipmentId).length;
    const ok = await confirm({
      title: "Undo this shipment?",
      message: `The whole parcel (${parcelCards} card${parcelCards === 1 ? "" : "s"}) goes back to not shipped and its shipping fee is removed from the customer's balance.`,
      confirmLabel: "Undo shipment",
      tone: "danger",
    });
    if (ok) run(() => undoShipment(sale.shipmentId as string));
  };

  const tabs: { id: Status; label: string; count: number }[] = [
    { id: "TODO", label: "To distribute / ship", count: todo },
    { id: "DONE", label: "Distributed / shipped", count: done },
    { id: "ALL", label: "All", count: inScope.length },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setStatus(t.id)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                status === t.id ? "border-gold bg-gold/10" : "border-card-border text-foreground-muted hover:text-foreground",
              )}
            >
              {t.label} <span className="text-xs text-foreground-muted">{t.count}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Select className="w-48" value={liveFilter} onChange={(e) => setLiveFilter(e.target.value)} aria-label="Filter by live">
            <option value="ALL">All lives</option>
            {lives.map((l) => (
              <option key={l.id} value={l.id}>
                {l.title} ({l.liveDate})
              </option>
            ))}
          </Select>
          <div className="relative w-48">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-foreground-muted" />
            <Input className="pl-8" placeholder="Customer or card" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
        </div>
      </div>

      {error && <p className="rounded-lg border border-sold/30 bg-sold-bg px-3 py-2 text-sm text-sold">{error}</p>}

      {groups.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-card-border py-12 text-center text-sm text-foreground-muted">
          {status === "TODO" ? "Nothing waiting - every card is distributed or shipped." : status === "DONE" ? "Nothing distributed or shipped yet." : "No cards match."}
        </p>
      ) : (
        groups.map((g) => {
          const customer = customerById.get(g.customerId);
          const totals = totalsByCustomer[g.customerId];
          const pendingItems = g.items.filter((s) => !isDone(s));
          const selectedHere = pendingItems.filter((s) => selected.has(s.id));
          const selectedHand = selectedHere.filter((s) => !s.forShipping);
          const selectedShip = selectedHere.filter((s) => s.forShipping);
          const allPendingSelected = pendingItems.length > 0 && selectedHere.length === pendingItems.length;
          return (
            <section key={g.customerId} className="rounded-2xl border border-card-border bg-card">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-card-border px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  {pendingItems.length > 0 && (
                    <input
                      type="checkbox"
                      aria-label={`Select all pending cards of ${g.name}`}
                      checked={allPendingSelected}
                      onChange={(e) => setMany(pendingItems.map((s) => s.id), e.target.checked)}
                      className="h-4 w-4 rounded border-card-border accent-gold"
                    />
                  )}
                  <Link href={`/tracker/customers/${g.customerId}`} className="font-semibold hover:text-gold">
                    {g.name}
                  </Link>
                  {customer?.islandGroup && <span className="text-xs text-foreground-muted">{ISLAND_GROUP_LABELS[customer.islandGroup]}</span>}
                  {totals && totals.balance > 0 && <Badge tone="pending">owes {formatCurrency(totals.balance)}</Badge>}
                  {totals && totals.prepaidShippingCredit > 0 && <Badge tone="gold">SF paid</Badge>}
                </div>
                <div className="flex flex-wrap gap-2">
                  {selectedHand.length > 0 && (
                    <Button
                      variant="gold"
                      type="button"
                      className="px-3 py-1.5"
                      disabled={pending}
                      onClick={() =>
                        run(async () => {
                          await setSalesDistributed(selectedHand.map((s) => s.id), true);
                          setMany(selectedHand.map((s) => s.id), false);
                        })
                      }
                    >
                      <Package size={13} /> Mark {selectedHand.length} distributed
                    </Button>
                  )}
                  {selectedShip.length > 0 && (
                    <Button
                      variant="gold"
                      type="button"
                      className="px-3 py-1.5"
                      disabled={pending}
                      onClick={() => setShipping({ customerId: g.customerId, saleIds: selectedShip.map((s) => s.id) })}
                    >
                      <Truck size={13} /> Mark {selectedShip.length} shipped
                    </Button>
                  )}
                </div>
              </div>
              <ul className="divide-y divide-card-border">
                {g.items.map((s) => {
                  const color = ownerColor(s.ownerTag, settings.ownerLabels);
                  const finished = isDone(s);
                  const shipment = s.shipmentId ? shipmentById.get(s.shipmentId) : null;
                  return (
                    <li key={s.id} className={cn("flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2 text-sm", color?.row)}>
                      {finished ? (
                        <span className="h-4 w-4" aria-hidden />
                      ) : (
                        <input
                          type="checkbox"
                          aria-label={`Select ${s.cardName}`}
                          checked={selected.has(s.id)}
                          onChange={() => toggle(s.id)}
                          className="h-4 w-4 rounded border-card-border accent-gold"
                        />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className={cn("inline-block max-w-full truncate rounded-md px-2 py-0.5 align-middle font-medium", color?.name)}>{s.cardName}</span>
                        <span className="ml-2 text-xs text-foreground-muted">{liveById.get(s.liveId)?.title}</span>
                      </span>
                      <span className="font-medium">{formatCurrency(s.amount)}</span>
                      <Badge tone="neutral">{s.forShipping ? "Ship" : "Hand over"}</Badge>
                      {finished ? (
                        <>
                          <Badge tone="available">
                            {s.forShipping ? `Shipped ${shipment?.shippedOn ?? ""}` : `Distributed ${s.distributedAt?.slice(0, 10) ?? ""}`}
                          </Badge>
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => (s.forShipping ? undoParcel(s) : run(() => setSalesDistributed([s.id], false)))}
                            className="inline-flex items-center gap-1 text-xs text-foreground-muted hover:text-sold disabled:opacity-40"
                          >
                            <Undo2 size={12} /> Undo
                          </button>
                        </>
                      ) : (
                        <Badge tone="pending">Pending</Badge>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })
      )}

      {shipping && customerById.get(shipping.customerId) && (
        <ShipDialog
          open
          onClose={() => setShipping(null)}
          onShipped={() => setMany(shipping.saleIds, false)}
          customer={{
            id: shipping.customerId,
            name: customerById.get(shipping.customerId)!.name,
            islandGroup: customerById.get(shipping.customerId)!.islandGroup,
          }}
          saleIds={shipping.saleIds}
          prepaidCredit={totalsByCustomer[shipping.customerId]?.prepaidShippingCredit ?? 0}
          rates={settings}
        />
      )}
    </div>
  );
}
