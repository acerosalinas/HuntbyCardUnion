"use client";

import { FormEvent, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { saveSettings, uploadTrackerQr } from "@/app/tracker/actions";
import type { TrackerSettings } from "@/lib/tracker/data";
import { cn, extractErrorMessage } from "@/lib/utils";

const label = "mb-1 block text-xs font-medium uppercase tracking-wide text-foreground-muted";

export function SettingsForm({ settings }: { settings: TrackerSettings }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [luzon, setLuzon] = useState(String(settings.luzonFee));
  const [vm, setVm] = useState(String(settings.visayasMindanaoFee));
  const [instructions, setInstructions] = useState(settings.paymentInstructions);
  const [showAddress, setShowAddress] = useState(settings.showAddressOnInvoice);
  const [gcashQr, setGcashQr] = useState<string | null>(settings.gcashQrUrl);
  const [maribankQr, setMaribankQr] = useState<string | null>(settings.maribankQrUrl);
  const [uploading, setUploading] = useState<"gcash" | "maribank" | null>(null);
  const [owners, setOwners] = useState(settings.ownerLabels.map((o) => ({ ...o })));

  const upload = async (kind: "gcash" | "maribank", file: File | undefined) => {
    if (!file) return;
    setError(null);
    setSaved(false);
    setUploading(kind);
    try {
      const body = new FormData();
      body.append("file", file);
      const url = await uploadTrackerQr(body);
      if (kind === "gcash") setGcashQr(url);
      else setMaribankQr(url);
    } catch (err) {
      setError(extractErrorMessage(err) ?? "Couldn't upload the image.");
    } finally {
      setUploading(null);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const luzonFee = Number(luzon);
    const visayasMindanaoFee = Number(vm);
    if (![luzonFee, visayasMindanaoFee].every((n) => Number.isFinite(n) && n >= 0)) {
      return setError("Shipping fees must be zero or more.");
    }
    setError(null);
    setSaved(false);
    startTransition(async () => {
      try {
        await saveSettings({
          luzonFee,
          visayasMindanaoFee,
          paymentInstructions: instructions,
          showAddressOnInvoice: showAddress,
          gcashQrUrl: gcashQr,
          maribankQrUrl: maribankQr,
          ownerLabels: owners.map((o) => ({ code: o.code.trim(), name: o.name.trim(), active: o.active !== false })).filter((o) => o.code || o.name),
        });
        setSaved(true);
      } catch (err) {
        setError(extractErrorMessage(err) ?? "Couldn't save.");
      }
    });
  };

  return (
    <form onSubmit={submit} className="max-w-xl space-y-5 rounded-2xl border border-card-border bg-card p-5">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label}>Luzon shipping fee</label>
          <Input type="number" inputMode="decimal" min={0} step="0.01" value={luzon} onChange={(e) => setLuzon(e.target.value)} />
        </div>
        <div>
          <label className={label}>Visayas &amp; Mindanao fee</label>
          <Input type="number" inputMode="decimal" min={0} step="0.01" value={vm} onChange={(e) => setVm(e.target.value)} />
        </div>
      </div>
      <div>
        <label className={label}>Payment instructions (added to the bottom of every invoice)</label>
        <Textarea
          rows={4}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          maxLength={1000}
          placeholder={"Pay via GCash: 09xx xxx xxxx (Name)\nMaribank: xxxx xxxx xxxx (Name)"}
        />
      </div>
      <div>
        <label className={label}>Payment QR codes</label>
        <p className="mb-2 text-xs text-foreground-muted">
          Upload your GCash and Maribank QR images. Every invoice gets a link to them, and Enter Sales has buttons to copy the QR image so you can paste it into the chat.
        </p>
        <div className="grid grid-cols-2 gap-3">
          {(
            [
              ["gcash", "GCash", gcashQr, setGcashQr],
              ["maribank", "Maribank", maribankQr, setMaribankQr],
            ] as const
          ).map(([kind, name, url, setUrl]) => (
            <div key={kind} className="rounded-xl border border-card-border p-3 text-center">
              <div className="mb-2 text-sm font-medium">{name}</div>
              {url ? (
                // eslint-disable-next-line @next/next/no-img-element -- user-uploaded QR from the R2 bucket, shown at its natural size
                <img src={url} alt={name + " QR code"} className="mx-auto mb-2 h-36 w-36 rounded-lg bg-white object-contain" />
              ) : (
                <div className="mx-auto mb-2 flex h-36 w-36 items-center justify-center rounded-lg border border-dashed border-card-border text-xs text-foreground-muted">
                  No QR yet
                </div>
              )}
              <label className="inline-flex cursor-pointer items-center rounded-lg border border-card-border px-3 py-1.5 text-xs font-medium hover:bg-foreground/5">
                {uploading === kind ? "Uploading..." : url ? "Replace" : "Upload"}
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  disabled={uploading !== null}
                  onChange={(e) => {
                    void upload(kind, e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </label>
              {url && (
                <button type="button" onClick={() => setUrl(null)} className="ml-2 text-xs text-foreground-muted hover:text-sold">
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-foreground-muted">Press Save settings below after uploading.</p>
      </div>
      <div>
        <label className={label}>Card owners</label>
        <p className="mb-2 text-xs text-foreground-muted">
          Tag each card with a short code while you sell (e.g. A for AC, S for Shane). The Dashboard splits every live&apos;s expected and actual totals by owner. Switch an owner to Inactive (red) to hide them from the graphs and progress bars - their cards still count in the totals.
        </p>
        <div className="space-y-2">
          {owners.map((o, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                className="w-20 uppercase"
                value={o.code}
                maxLength={8}
                placeholder="Code"
                aria-label="Owner code"
                onChange={(e) => setOwners(owners.map((x, j) => (j === i ? { ...x, code: e.target.value } : x)))}
              />
              <Input
                value={o.name}
                maxLength={40}
                placeholder="Name"
                aria-label="Owner name"
                onChange={(e) => setOwners(owners.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
              />
              <button
                type="button"
                role="switch"
                aria-checked={o.active !== false}
                aria-label={`${o.name || "Owner"} ${o.active !== false ? "active" : "inactive"} - click to switch`}
                title="Show this owner in the Dashboard graphs and progress bars"
                onClick={() => setOwners(owners.map((x, j) => (j === i ? { ...x, active: x.active === false } : x)))}
                className="flex shrink-0 items-center gap-2"
              >
                <span
                  className={cn(
                    "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
                    o.active !== false ? "bg-available" : "bg-sold",
                  )}
                >
                  <span
                    className={cn(
                      "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform",
                      o.active !== false ? "translate-x-5" : "translate-x-0.5",
                    )}
                  />
                </span>
                <span className={cn("w-14 text-left text-xs font-semibold", o.active !== false ? "text-available" : "text-sold")}>
                  {o.active !== false ? "Active" : "Inactive"}
                </span>
              </button>
              <Button type="button" variant="outline" className="px-3" disabled={owners.length <= 1} onClick={() => setOwners(owners.filter((_, j) => j !== i))}>
                Remove
              </Button>
            </div>
          ))}
        </div>
        {owners.length < 6 && (
          <Button type="button" variant="outline" className="mt-2" onClick={() => setOwners([...owners, { code: "", name: "", active: true }])}>
            Add owner
          </Button>
        )}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={showAddress} onChange={(e) => setShowAddress(e.target.checked)} className="h-4 w-4 rounded border-card-border accent-gold" />
        Show the customer&apos;s ship-to address on invoices (only when they have cards to ship)
      </label>
      {error && <p className="text-sm text-sold">{error}</p>}
      {saved && !error && <p className="text-sm text-available">Saved.</p>}
      <Button type="submit" variant="gold" disabled={pending}>
        Save settings
      </Button>
    </form>
  );
}
