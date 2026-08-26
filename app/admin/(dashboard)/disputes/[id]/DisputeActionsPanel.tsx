"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ImageOff } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Input";
import { canTransitionDispute, isDisputeResolved } from "@/lib/disputeStatus";
import { extractErrorMessage } from "@/lib/utils";
import { checkImageTypeClientSide } from "@/lib/imageAccept";
import { Dispute, DisputeEvidenceItem } from "@/types/marketplace";
import { markDisputeUnderReview, resolveDispute, respondToDispute } from "@/app/admin/actions";

export function DisputeActionsPanel({ dispute, evidence }: { dispute: Dispute; evidence: DisputeEvidenceItem[] }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [resolutionNote, setResolutionNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (action: () => Promise<void>) => {
    setError(null);
    startTransition(async () => {
      try {
        await action();
        router.refresh();
      } catch (err) {
        setError(extractErrorMessage(err) ?? "Action failed");
      }
    });
  };

  const handleRespond = (e: FormEvent) => {
    e.preventDefault();
    if (!note.trim() && !file) {
      setError("Add a note or a photo to respond.");
      return;
    }
    if (file) {
      const typeError = checkImageTypeClientSide(file);
      if (typeError) {
        setError(typeError);
        return;
      }
    }
    run(async () => {
      await respondToDispute(dispute.id, note, file);
      setNote("");
      setFile(null);
    });
  };

  const resolved = isDisputeResolved(dispute.status);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-foreground-muted">Timeline</h2>
        <div className="space-y-3">
          {evidence.length === 0 && <p className="text-sm text-foreground-muted">No activity yet.</p>}
          {evidence.map((item) => (
            <div key={item.id} className="rounded-xl border border-card-border bg-card p-3">
              <p className="mb-1 text-xs font-medium text-foreground-muted">
                {item.uploaderRole === "BUYER" ? "Buyer" : "You"} &middot;{" "}
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
      </div>

      {error && <p className="text-sm text-sold">{error}</p>}

      {!resolved && (
        <>
          <form onSubmit={handleRespond} className="space-y-2 rounded-xl border border-card-border bg-card p-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">Respond</h3>
            <Textarea
              rows={3}
              placeholder="Message to the buyer..."
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="text-sm text-foreground-muted"
            />
            <Button type="submit" variant="outline" disabled={pending}>
              {pending ? "Sending..." : "Send Response"}
            </Button>
          </form>

          <div className="space-y-2 rounded-xl border border-card-border bg-card p-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">Resolve</h3>
            {canTransitionDispute(dispute.status, "UNDER_REVIEW") && (
              <Button
                variant="outline"
                disabled={pending}
                onClick={() => run(() => markDisputeUnderReview(dispute.id))}
              >
                Mark Under Review
              </Button>
            )}
            <Textarea
              rows={2}
              placeholder="Resolution note (shown in the record)..."
              value={resolutionNote}
              onChange={(e) => setResolutionNote(e.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                disabled={pending}
                onClick={() => run(() => resolveDispute(dispute.id, "REFUND", resolutionNote))}
              >
                Resolve - Issue Refund
              </Button>
              <Button
                variant="danger"
                disabled={pending}
                onClick={() => run(() => resolveDispute(dispute.id, "DISMISSED", resolutionNote))}
              >
                Resolve - Dismiss
              </Button>
            </div>
          </div>
        </>
      )}

      {resolved && dispute.resolutionNote && (
        <div className="rounded-xl border border-card-border bg-card p-3 text-sm">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-foreground-muted">Resolution</p>
          <p className="text-foreground">{dispute.resolutionNote}</p>
        </div>
      )}
    </div>
  );
}
