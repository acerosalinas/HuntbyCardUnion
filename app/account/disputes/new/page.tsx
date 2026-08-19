"use client";

import { FormEvent, Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";
import { DISPUTE_REASON_LABELS } from "@/lib/disputeLabels";
import { DisputeReason } from "@/types/marketplace";

function NewDisputeForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const cardId = searchParams.get("cardId");
  const [reason, setReason] = useState<DisputeReason>("ITEM_NOT_RECEIVED");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!cardId) {
    return (
      <p className="text-sm text-foreground-muted">
        No item selected. Go back to My Dibs and choose an item to report.
      </p>
    );
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!description.trim()) {
      setError("Describe what happened.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const supabase = createClient();
      const { data, error: rpcError } = await supabase.rpc("open_dispute", {
        p_card_id: cardId,
        p_reason: reason,
        p_description: description.trim(),
      });
      if (rpcError) throw rpcError;
      const created = data as { id: string };
      router.push(`/account/disputes/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to open dispute");
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="w-full space-y-3">
      <div>
        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-foreground-muted">
          Reason
        </label>
        <Select value={reason} onChange={(e) => setReason(e.target.value as DisputeReason)}>
          {Object.entries(DISPUTE_REASON_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-foreground-muted">
          What happened?
        </label>
        <Textarea
          rows={5}
          placeholder="Describe the issue in detail..."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          required
        />
      </div>
      {error && <p className="text-sm text-sold">{error}</p>}
      <Button type="submit" variant="gold" className="w-full" disabled={submitting}>
        {submitting ? "Submitting..." : "Open Dispute"}
      </Button>
    </form>
  );
}

export default function NewDisputePage() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-16">
      <div className="flex h-14 w-14 items-center justify-center rounded-full border border-gold/40 bg-navy-950 text-gold glow-gold">
        <AlertTriangle size={26} />
      </div>
      <h1 className="text-xl font-semibold">Report an Issue</h1>
      <Suspense>
        <NewDisputeForm />
      </Suspense>
    </div>
  );
}
