"use client";

import { FormEvent, useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { submitOrderProof } from "@/app/account/orderProofActions";
import { formatCurrency } from "@/lib/utils";

export interface ProofClaim {
  claimId: string;
  title: string;
  total: number;
}

/** Send a payment screenshot for one unpaid order - and, if ticked, the buyer's other unpaid orders from the same seller. */
export function OrderProofDialog({
  claim,
  siblings,
  onClose,
  onSent,
}: {
  claim: ProofClaim;
  siblings: ProofClaim[];
  onClose: () => void;
  onSent: (claimIds: string[]) => void;
}) {
  const all = [claim, ...siblings];
  const [picked, setPicked] = useState<Set<string>>(new Set(all.map((c) => c.claimId)));
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = all.filter((c) => picked.has(c.claimId)).reduce((n, c) => n + c.total, 0);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) return setError("Attach a screenshot of your payment.");
    if (picked.size === 0) return setError("Tick at least one order.");
    setBusy(true);
    setError(null);
    const body = new FormData();
    body.set("claimIds", JSON.stringify([...picked]));
    body.set("note", note);
    body.set("proof", file);
    const result = await submitOrderProof(body);
    setBusy(false);
    if (result.error) return setError(result.error);
    onSent([...picked]);
    onClose();
  };

  return (
    <Modal open onClose={onClose} title="Send proof of payment" className="max-w-md">
      <form onSubmit={submit} className="space-y-3">
        <p className="text-sm text-foreground-muted">
          Attach your payment screenshot. The seller checks it and confirms your payment - it isn&apos;t marked paid until they do.
        </p>
        <ul className="divide-y divide-card-border rounded-xl border border-card-border text-sm">
          {all.map((c) => (
            <li key={c.claimId}>
              <label className="flex cursor-pointer items-center gap-2 px-3 py-2">
                <input
                  type="checkbox"
                  checked={picked.has(c.claimId)}
                  disabled={all.length === 1}
                  onChange={() =>
                    setPicked((prev) => {
                      const next = new Set(prev);
                      if (next.has(c.claimId)) next.delete(c.claimId);
                      else next.add(c.claimId);
                      return next;
                    })
                  }
                  className="h-4 w-4 rounded border-card-border accent-gold"
                />
                <span className="min-w-0 flex-1 truncate">{c.title}</span>
                <span className="font-medium tabular-nums">{formatCurrency(c.total)}</span>
              </label>
            </li>
          ))}
        </ul>
        <p className="text-sm">
          Covers <span className="font-semibold">{formatCurrency(total)}</span>
        </p>
        <div>
          <label htmlFor="order-proof-file" className="mb-1 block text-xs font-medium uppercase tracking-wide text-foreground-muted">
            Screenshot
          </label>
          <input
            id="order-proof-file"
            type="file"
            accept="image/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm file:mr-3 file:rounded-lg file:border file:border-card-border file:bg-transparent file:px-3 file:py-1.5 file:text-sm file:text-foreground"
          />
        </div>
        <div>
          <label htmlFor="order-proof-note" className="mb-1 block text-xs font-medium uppercase tracking-wide text-foreground-muted">
            Note (optional)
          </label>
          <Input id="order-proof-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="e.g. Paid via GCash at 3:40 PM" />
        </div>
        {error && <p className="text-sm text-sold">{error}</p>}
        <Button type="submit" variant="gold" disabled={busy} className="w-full">
          <Send size={14} /> {busy ? "Sending..." : "Send proof"}
        </Button>
      </form>
    </Modal>
  );
}
