"use client";

import { useState } from "react";
import { Receipt } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";

/** Opens the buyer's payment screenshot for a claim in a popup, so it can be checked before pressing Confirm Paid. */
export function PaymentProofButton({ url, note, title, className }: { url: string; note: string | null; title: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="gold" type="button" onClick={() => setOpen(true)} className={className}>
        <Receipt size={13} /> View proof
      </Button>
      {open && (
        <Modal open onClose={() => setOpen(false)} title={`Payment proof · ${title}`} className="max-w-md">
          <div className="space-y-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- private signed URL, not optimisable by next/image */}
            <img src={url} alt={`Payment proof for ${title}`} className="mx-auto max-h-[70vh] w-auto max-w-full rounded-lg border border-card-border bg-white object-contain" />
            {note && <p className="rounded-lg bg-foreground/5 px-3 py-2 text-sm">&ldquo;{note}&rdquo;</p>}
            <p className="text-xs text-foreground-muted">Check the amount and date, then use Confirm Paid on the order.</p>
          </div>
        </Modal>
      )}
    </>
  );
}
