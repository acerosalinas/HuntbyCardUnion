"use client";

import { ChangeEvent, FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ImageOff } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Input";
import { createClient } from "@/lib/supabase/client";
import { isDisputeResolved } from "@/lib/disputeStatus";
import { extractErrorMessage } from "@/lib/utils";
import { checkImageTypeClientSide, ACCEPTED_IMAGE_ACCEPT_ATTR } from "@/lib/imageAccept";
import { normalizeImageFile } from "@/lib/imageNormalize";
import { Dispute, DisputeEvidenceItem } from "@/types/marketplace";
import { uploadDisputeEvidence } from "../actions";

export function EvidenceTimeline({ dispute, evidence }: { dispute: Dispute; evidence: DisputeEvidenceItem[] }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preparingFile, setPreparingFile] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [withdrawing, setWithdrawing] = useState(false);

  const resolved = isDisputeResolved(dispute.status);

  const handleFileSelected = async (e: ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0] ?? null;
    if (!picked) {
      setFile(null);
      return;
    }
    setPreparingFile(true);
    try {
      setFile(await normalizeImageFile(picked));
    } finally {
      setPreparingFile(false);
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (file) {
      const typeError = checkImageTypeClientSide(file);
      if (typeError) {
        setError(typeError);
        return;
      }
    }
    startTransition(async () => {
      try {
        await uploadDisputeEvidence(dispute.id, note, file);
        setNote("");
        setFile(null);
        router.refresh();
      } catch (err) {
        setError(extractErrorMessage(err) ?? "Failed to add evidence");
      }
    });
  };

  const handleWithdraw = async () => {
    setError(null);
    setWithdrawing(true);
    try {
      const supabase = createClient();
      const { error: rpcError } = await supabase.rpc("withdraw_dispute", { p_dispute_id: dispute.id });
      if (rpcError) throw rpcError;
      router.refresh();
    } catch (err) {
      setError(extractErrorMessage(err) ?? "Failed to withdraw dispute");
      setWithdrawing(false);
    }
  };

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-muted">Timeline</h2>
      <div className="space-y-3">
        {evidence.length === 0 && <p className="text-sm text-foreground-muted">No activity yet.</p>}
        {evidence.map((item) => (
          <div key={item.id} className="rounded-xl border border-card-border bg-card p-3">
            <p className="mb-1 text-xs font-medium text-foreground-muted">
              {item.uploaderRole === "BUYER" ? "You" : "Seller / Admin"} &middot;{" "}
              {new Date(item.createdAt).toLocaleString()}
            </p>
            {item.note && <p className="text-sm text-foreground">{item.note}</p>}
            {item.signedUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- short-lived signed Supabase Storage URL, not a local asset
              <img
                src={item.signedUrl}
                alt={item.fileName ?? "Evidence"}
                className="mt-2 max-h-64 rounded-lg object-contain"
              />
            ) : item.storagePath ? (
              <div className="mt-2 flex h-24 w-24 items-center justify-center rounded-lg bg-navy-950/5 text-foreground-muted">
                <ImageOff size={20} />
              </div>
            ) : null}
          </div>
        ))}
      </div>

      {!resolved && (
        <form onSubmit={handleSubmit} className="space-y-2 rounded-xl border border-card-border bg-card p-3">
          <Textarea rows={3} placeholder="Add a note..." value={note} onChange={(e) => setNote(e.target.value)} />
          <input
            type="file"
            accept={ACCEPTED_IMAGE_ACCEPT_ATTR}
            disabled={preparingFile}
            onChange={handleFileSelected}
            className="text-sm text-foreground-muted"
          />
          {error && <p className="text-sm text-sold">{error}</p>}
          <div className="flex justify-end gap-2">
            {dispute.status === "OPEN" && (
              <Button type="button" variant="danger" disabled={pending || withdrawing} onClick={handleWithdraw}>
                {withdrawing ? "Withdrawing..." : "Withdraw Dispute"}
              </Button>
            )}
            <Button type="submit" variant="gold" disabled={pending || preparingFile}>
              {preparingFile ? "Preparing photo..." : pending ? "Sending..." : "Add Update"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
