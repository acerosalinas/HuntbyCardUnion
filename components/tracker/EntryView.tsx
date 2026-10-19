"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, KeyboardEvent, useMemo, useRef, useState, useTransition } from "react";
import { ClipboardCopy, Plus, QrCode, Trash2, Truck, UserPlus } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { addSale, createLive, deleteSale, setSalesForShipping, setSalesOwner } from "@/app/tracker/actions";
import { buildInvoiceText } from "@/lib/tracker/invoice";
import { copyImageFromUrl, copyText } from "@/lib/tracker/clipboard";
import { shippingFeeFor } from "@/lib/tracker/regions";
import { ownerColor } from "@/lib/tracker/ownerColors";
import { CustomerTotals } from "@/lib/tracker/money";
import type { TrackerCustomer, TrackerLive, TrackerSale, TrackerSettings } from "@/lib/tracker/data";
import { cn, extractErrorMessage, formatCurrency } from "@/lib/utils";

function todayLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

interface Props {
  liveId: string | null;
  lives: TrackerLive[];
  customers: TrackerCustomer[];
  /** Sales of the selected live only. */
  sales: TrackerSale[];
  totalsByCustomer: Record<string, CustomerTotals>;
  settings: TrackerSettings;
}

export function EntryView({ liveId, lives, customers, sales, totalsByCustomer, settings }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [customerName, setCustomerName] = useState("");
  const [cardName, setCardName] = useState("");
  const [amount, setAmount] = useState("");
  const [forShipping, setForShipping] = useState(false);
  // "ALL" | "NONE" (untagged) | an owner code
  const [ownerFilter, setOwnerFilter] = useState<string>("ALL");
  const cardRef = useRef<HTMLInputElement>(null);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);

  const [newLiveTitle, setNewLiveTitle] = useState("");
  const [newLiveDate, setNewLiveDate] = useState(todayLocal);
  const [showNewLive, setShowNewLive] = useState(lives.length === 0);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const live = lives.find((l) => l.id === liveId) ?? null;
  const customerById = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);
  const matched = useMemo(
    () => customers.find((c) => c.name.trim().toLowerCase() === customerName.trim().toLowerCase()) ?? null,
    [customers, customerName],
  );
  const matchedTotals = matched ? totalsByCustomer[matched.id] : null;

  // Saved customers matching what's typed: names starting with it first, then names containing it. An exact match needs no suggestion.
  const suggestions = useMemo(() => {
    const q = customerName.trim().toLowerCase();
    if (!q || customers.some((c) => c.name.toLowerCase() === q)) return [];
    const starts = customers.filter((c) => c.name.toLowerCase().startsWith(q));
    const contains = customers.filter((c) => !c.name.toLowerCase().startsWith(q) && c.name.toLowerCase().includes(q));
    return [...starts, ...contains].slice(0, 6);
  }, [customers, customerName]);

  const pickCustomer = (c: TrackerCustomer) => {
    setCustomerName(c.name);
    setSuggestOpen(false);
    cardRef.current?.focus();
  };

  const onCustomerKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!suggestOpen || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => (h + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => (h - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      // Enter/Tab accept the highlighted match instead of submitting the form.
      e.preventDefault();
      pickCustomer(suggestions[Math.min(highlight, suggestions.length - 1)]);
    } else if (e.key === "Escape") {
      setSuggestOpen(false);
    }
  };

  const ownerLabels = settings.ownerLabels;

  // Group the live's cards by customer, in the order each customer first appeared.
  const groupSales = (list: TrackerSale[]) => {
    const map = new Map<string, TrackerSale[]>();
    for (const s of list) map.set(s.customerId, [...(map.get(s.customerId) ?? []), s]);
    return [...map.entries()].map(([customerId, items]) => ({
      customerId,
      items,
      subtotal: items.reduce((sum, i) => sum + i.amount, 0),
    }));
  };
  // Invoices always use ALL of a customer's cards in the live; the owner filter only changes what's listed.
  const allGroups = useMemo(() => groupSales(sales), [sales]);
  const filteredSales = useMemo(
    () => sales.filter((s) => (ownerFilter === "ALL" ? true : ownerFilter === "NONE" ? s.ownerTag === null : s.ownerTag === ownerFilter)),
    [sales, ownerFilter],
  );
  const groups = useMemo(() => groupSales(filteredSales), [filteredSales]);
  const liveTotal = allGroups.reduce((sum, g) => sum + g.subtotal, 0);
  const filteredTotal = groups.reduce((sum, g) => sum + g.subtotal, 0);
  const filterOptions = [
    { id: "ALL", label: "All", count: sales.length },
    ...ownerLabels.map((o) => ({ id: o.code, label: o.name, count: sales.filter((s) => s.ownerTag === o.code).length })),
    { id: "NONE", label: "Unassigned", count: sales.filter((s) => s.ownerTag === null).length },
  ];

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

  // The owner is chosen at the moment of adding (an "Add for ..." button, or pressing the owner's letter
  // in the Amount field) - there is deliberately no remembered owner that could be left on the wrong one.
  const submitSale = (e: FormEvent) => {
    e.preventDefault();
    setError("Choose who owns this card - tap " + ownerLabels.map((o) => o.name).join(" or ") + " below.");
  };

  const addCard = (ownerTag: string) => {
    if (!liveId) return setError("Create or pick a live first.");
    const value = Number(amount);
    if (!customerName.trim()) return setError("Enter the customer's name.");
    if (!cardName.trim()) return setError("Enter the card name.");
    if (amount.trim() === "" || !Number.isFinite(value) || value < 0) return setError("Enter a valid amount.");
    run(async () => {
      const result = await addSale({ liveId, customerName, cardName, amount: value, forShipping, ownerTag });
      setNotice(result.newCustomer ? `Added new customer ${customerName.trim()}.` : null);
      setCardName("");
      setAmount("");
      cardRef.current?.focus();
    });
  };

  const submitLive = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      const id = await createLive(newLiveTitle, newLiveDate);
      setNewLiveTitle("");
      setShowNewLive(false);
      router.replace(`/tracker?live=${id}`);
    });
  };

  const qrLinks = [
    { label: "GCash", url: settings.gcashQrUrl ?? "" },
    { label: "Maribank", url: settings.maribankQrUrl ?? "" },
  ].filter((q) => q.url);

  // Copies the QR as an image to paste into the chat; if the browser blocks that, copies the link instead and says so.
  const copyQr = async (key: string, label: string, url: string) => {
    if (await copyImageFromUrl(url)) {
      setCopiedKey(key);
    } else if (await copyText(url)) {
      setCopiedKey(key);
      setNotice("Couldn't copy the " + label + " QR as an image here, so its link was copied instead.");
    } else {
      setError("Couldn't copy the " + label + " QR.");
    }
    setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 2000);
  };

  const invoiceFor = (customerId: string, items: TrackerSale[]): string | null => {
    const customer = customerById.get(customerId);
    const totals = totalsByCustomer[customerId];
    if (!customer || !totals || !live) return null;
    return buildInvoiceText({
      customerName: customer.name,
      liveTitle: live.title,
      cards: items.map((i) => ({ cardName: i.cardName, amount: i.amount })),
      totals,
      shippingFee: shippingFeeFor(customer.islandGroup, settings),
      islandGroup: customer.islandGroup,
      address: customer.address,
      showAddress: settings.showAddressOnInvoice,
      paymentInstructions: settings.paymentInstructions,
      qrLinks: qrLinks,
    });
  };

  const copy = async (key: string, text: string | null) => {
    if (!text) return;
    const ok = await copyText(text);
    setCopiedKey(ok ? key : null);
    if (!ok) setError("Couldn't copy - your browser blocked clipboard access.");
    setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 2000);
  };

  const copyAll = () =>
    copy(
      "all",
      allGroups
        .map((g) => invoiceFor(g.customerId, g.items))
        .filter(Boolean)
        .join("\n\n----------\n\n"),
    );

  return (
    <div className="space-y-5">
      {/* Live picker */}
      <div className="rounded-2xl border border-card-border bg-card p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[14rem] flex-1">
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-foreground-muted">Live</label>
            <Select
              value={liveId ?? ""}
              disabled={lives.length === 0}
              onChange={(e) => router.replace(`/tracker?live=${e.target.value}`)}
            >
              {lives.length === 0 && <option value="">No lives yet</option>}
              {lives.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.title} ({l.liveDate})
                </option>
              ))}
            </Select>
          </div>
          <Button variant="outline" type="button" onClick={() => setShowNewLive((v) => !v)}>
            <Plus size={14} /> New live
          </Button>
        </div>
        {showNewLive && (
          <form onSubmit={submitLive} className="mt-3 flex flex-wrap items-end gap-3 border-t border-card-border pt-3">
            <div className="min-w-[12rem] flex-1">
              <label className="mb-1 block text-xs text-foreground-muted">Title</label>
              <Input value={newLiveTitle} onChange={(e) => setNewLiveTitle(e.target.value)} placeholder="e.g. Friday night live" maxLength={120} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-foreground-muted">Date</label>
              <Input type="date" value={newLiveDate} onChange={(e) => setNewLiveDate(e.target.value)} />
            </div>
            <Button type="submit" variant="gold" disabled={pending}>
              Create live
            </Button>
          </form>
        )}
      </div>

      {error && <p className="rounded-lg border border-sold/30 bg-sold-bg px-3 py-2 text-sm text-sold">{error}</p>}
      {notice && !error && <p className="text-sm text-available">{notice}</p>}

      {/* Rapid entry */}
      {live ? (
        <form onSubmit={submitSale} className="rounded-2xl border border-card-border bg-card p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1.2fr_1.6fr_0.8fr]">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-foreground-muted">Customer</label>
              <div className="relative">
                <Input
                  value={customerName}
                  onChange={(e) => {
                    setCustomerName(e.target.value);
                    setSuggestOpen(true);
                    setHighlight(0);
                  }}
                  onFocus={() => setSuggestOpen(true)}
                  onBlur={() => setSuggestOpen(false)}
                  onKeyDown={onCustomerKeyDown}
                  placeholder="Type a name"
                  autoComplete="off"
                  role="combobox"
                  aria-expanded={suggestOpen && suggestions.length > 0}
                  aria-autocomplete="list"
                  maxLength={120}
                />
                {suggestOpen && suggestions.length > 0 && (
                  <ul role="listbox" className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-lg border border-card-border bg-background-elevated shadow-xl">
                    {suggestions.map((c, i) => {
                      const balance = totalsByCustomer[c.id]?.balance ?? 0;
                      return (
                        <li
                          key={c.id}
                          role="option"
                          aria-selected={i === highlight}
                          // mousedown (not click) so it fires before the input's blur closes the list.
                          onMouseDown={(e) => {
                            e.preventDefault();
                            pickCustomer(c);
                          }}
                          onMouseEnter={() => setHighlight(i)}
                          className={`flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm ${i === highlight ? "bg-gold/15" : ""}`}
                        >
                          <span className="truncate">{c.name}</span>
                          {balance > 0 && <span className="shrink-0 text-xs text-pending">owes {formatCurrency(balance)}</span>}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-foreground-muted">Card</label>
              <Input ref={cardRef} value={cardName} onChange={(e) => setCardName(e.target.value)} placeholder="Card name" maxLength={200} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-foreground-muted">Amount (PHP)</label>
              <Input
                inputMode="decimal"
                value={amount}
                onChange={(e) => {
                  // digits and a single decimal point only
                  const cleaned = e.target.value.replace(/[^0-9.]/g, "");
                  const firstDot = cleaned.indexOf(".");
                  setAmount(firstDot === -1 ? cleaned : cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, ""));
                }}
                onKeyDown={(e) => {
                  // Typing an owner's letter (A / S) in the amount adds the card for that owner.
                  if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
                  const owner = ownerLabels.find((o) => o.code.length === 1 && /[A-Z]/.test(o.code) && o.code === e.key.toUpperCase());
                  if (owner) {
                    e.preventDefault();
                    addCard(owner.code);
                  }
                }}
                placeholder="0"
              />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={forShipping}
                  onChange={(e) => setForShipping(e.target.checked)}
                  className="h-4 w-4 rounded border-card-border accent-gold"
                />
                For shipping
              </label>
              {customerName.trim() &&
                (matched ? (
                  <span className="text-foreground-muted">
                    Balance:{" "}
                    <span className={matchedTotals && matchedTotals.balance > 0 ? "font-semibold text-pending" : "font-semibold text-available"}>
                      {formatCurrency(matchedTotals?.balance ?? 0)}
                    </span>
                  </span>
                ) : (
                  <Badge tone="gold">
                    <UserPlus size={12} className="mr-1" /> New customer
                  </Badge>
                ))}
            </div>
          </div>
          <div className="mt-3 border-t border-card-border pt-3">
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Add card for owner">
              <span className="text-sm text-foreground-muted">Add card for:</span>
              {ownerLabels.map((o) => (
                <button
                  key={o.code}
                  // type="button", not "submit": otherwise pressing Enter in a text field would silently click the FIRST owner's button.
                  type="button"
                  disabled={pending}
                  onClick={() => addCard(o.code)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold shadow-sm transition-colors disabled:opacity-60",
                    ownerColor(o.code, ownerLabels)?.button ?? "bg-gold text-navy-950",
                  )}
                >
                  <Plus size={14} /> {o.name}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-foreground-muted">
              Tip: after typing the amount, press {ownerLabels.filter((o) => o.code.length === 1 && /[A-Z]/.test(o.code)).map((o) => o.code).join(" or ") || "an owner button"} to add it for that owner.
            </p>
          </div>
        </form>
      ) : (
        <p className="rounded-2xl border border-dashed border-card-border py-10 text-center text-sm text-foreground-muted">
          Create your first live above to start entering sales.
        </p>
      )}

      {/* This live's sales */}
      {live && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">
              {live.title}{" "}
              <span className="text-sm font-normal text-foreground-muted">
                · {allGroups.length} customers · {sales.length} cards · {formatCurrency(liveTotal)}
                {ownerFilter !== "ALL" && <> · showing {filteredSales.length} ({formatCurrency(filteredTotal)})</>}
              </span>
            </h2>
            <div className="flex flex-wrap gap-2">
              {qrLinks.map((q) => (
                <Button key={q.label} variant="outline" type="button" onClick={() => copyQr("qr-" + q.label, q.label, q.url)}>
                  <QrCode size={14} /> {copiedKey === "qr-" + q.label ? "Copied!" : "Copy " + q.label + " QR"}
                </Button>
              ))}
              {allGroups.length > 0 && (
                <Button variant="outline" type="button" onClick={copyAll}>
                  <ClipboardCopy size={14} /> {copiedKey === "all" ? "Copied!" : "Copy all invoices"}
                </Button>
              )}
            </div>
          </div>

          {sales.length > 0 && (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filter cards by owner">
              {filterOptions.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setOwnerFilter(f.id)}
                  aria-pressed={ownerFilter === f.id}
                  className={cn(
                    "rounded-full border px-3 py-1 text-sm transition-colors",
                    ownerColor(f.id, ownerLabels)
                      ? ownerFilter === f.id
                        ? ownerColor(f.id, ownerLabels)!.chipOn
                        : ownerColor(f.id, ownerLabels)!.chipOff
                      : ownerFilter === f.id
                        ? "border-gold bg-gold/10 font-medium"
                        : "border-card-border text-foreground-muted hover:text-foreground",
                  )}
                >
                  {f.label} <span className="text-xs text-foreground-muted">{f.count}</span>
                </button>
              ))}
            </div>
          )}

          {groups.length === 0 && (
            <p className="rounded-2xl border border-dashed border-card-border py-10 text-center text-sm text-foreground-muted">
              {sales.length === 0 ? "No cards entered for this live yet." : "No cards match this owner filter."}
            </p>
          )}

          {groups.map((g) => {
            const customer = customerById.get(g.customerId);
            const totals = totalsByCustomer[g.customerId];
            return (
              <div key={g.customerId} className="rounded-2xl border border-card-border bg-card">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-card-border px-4 py-3">
                  <div>
                    <Link href={`/tracker/customers/${g.customerId}`} className="font-semibold hover:text-gold">
                      {customer?.name ?? "Customer"}
                    </Link>
                    <span className="ml-2 text-sm text-foreground-muted">
                      {formatCurrency(g.subtotal)}
                      {totals && totals.balance > 0 && <> · owes {formatCurrency(totals.balance)} overall</>}
                    </span>
                  </div>
                  <Button variant="outline" type="button" className="px-3 py-1.5" onClick={() => copy(g.customerId, invoiceFor(g.customerId, sales.filter((x) => x.customerId === g.customerId)))}>
                    <ClipboardCopy size={13} /> {copiedKey === g.customerId ? "Copied!" : "Copy invoice"}
                  </Button>
                </div>
                <ul className="divide-y divide-card-border">
                  {g.items.map((s) => {
                    const color = ownerColor(s.ownerTag, ownerLabels);
                    return (
                    <li key={s.id} className={cn("flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2 text-sm", color?.row)}>
                      <span className="min-w-0 flex-1">
                        <span className={cn("inline-block max-w-full truncate rounded-md px-2 py-0.5 align-middle font-medium", color?.name ?? "text-foreground")}>{s.cardName}</span>
                        {!s.ownerTag && <span className="ml-2 text-xs text-pending">no owner</span>}
                      </span>
                      <span className="font-medium">{formatCurrency(s.amount)}</span>
                      <span className="flex items-center gap-1" role="group" aria-label={"Owner of " + s.cardName}>
                        {ownerLabels.map((o) => {
                          const c = ownerColor(o.code, ownerLabels);
                          const active = s.ownerTag === o.code;
                          return (
                            <button
                              key={o.code}
                              type="button"
                              aria-pressed={active}
                              disabled={pending}
                              onClick={() => !active && run(() => setSalesOwner([s.id], o.code))}
                              className={cn("rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors", active ? c?.chipOn : c?.chipOff)}
                            >
                              {o.name}
                            </button>
                          );
                        })}
                      </span>
                      <label className="flex items-center gap-1.5 text-xs text-foreground-muted">
                        <input
                          type="checkbox"
                          checked={s.forShipping}
                          disabled={pending || s.shipmentId !== null}
                          onChange={(e) => run(() => setSalesForShipping([s.id], e.target.checked))}
                          className="h-3.5 w-3.5 rounded border-card-border accent-gold"
                        />
                        Ship
                      </label>
                      {s.shipmentId && (
                        <Badge tone="available">
                          <Truck size={12} className="mr-1" /> Shipped
                        </Badge>
                      )}
                      <button
                        type="button"
                        aria-label={`Delete ${s.cardName}`}
                        disabled={pending || s.shipmentId !== null}
                        onClick={() => run(() => deleteSale(s.id))}
                        className="rounded p-1 text-foreground-muted hover:text-sold disabled:opacity-30"
                      >
                        <Trash2 size={14} />
                      </button>
                    </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
