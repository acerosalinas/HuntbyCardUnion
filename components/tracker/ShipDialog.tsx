"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { markShipped } from "@/app/tracker/actions";
import { ISLAND_GROUP_LABELS, IslandGroup, ShippingRates, shippingFeeFor } from "@/lib/tracker/regions";
import { extractErrorMessage, formatCurrency } from "@/lib/utils";

const label = "mb-1 block text-xs font-medium uppercase tracking-wide text-foreground-muted";

interface Props {
  open: boolean;
  onClose: () => void;
  onShipped?: () => void;
  customer: { id: string; name: string; islandGroup: IslandGroup | null };
  saleIds: string[];
  /** Prepaid shipping money the customer has on file, not yet used by a parcel. */
  prepaidCredit: number;
  rates: ShippingRates;
}

/** "Mark parcel as shipped": one parcel = one shipping fee, however many cards. Shared by the customer page and the Enter Sales screen. */
export function ShipDialog(props: Props) {
  // The body mounts only while open, so its fee/note start fresh from the current customer every time.
  return (
    <Modal open={props.open} onClose={props.onClose} title="Mark parcel as shipped">
      <ShipDialogBody {...props} />
    </Modal>
  );
}

function ShipDialogBody({ onClose, onShipped, customer, saleIds, prepaidCredit, rates }: Props) {
  const defaultFee = shippingFeeFor(customer.islandGroup, rates);
  const [fee, setFee] = useState(defaultFee === null ? "" : String(defaultFee));
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const feeNumber = Number(fee);
  const feeValid = fee.trim() !== "" && Number.isFinite(feeNumber) && feeNumber >= 0;
  const prepaidCovers = feeValid ? Math.min(prepaidCredit, feeNumber) : 0;

  const submit = () => {
    if (!feeValid) return setError("Enter the shipping fee (use 0 to waive it).");
    setError(null);
    startTransition(async () => {
      try {
        await markShipped({ customerId: customer.id, saleIds, fee: feeNumber, note });
        onClose();
        onShipped?.();
      } catch (err) {
        setError(extractErrorMessage(err) ?? "Couldn't mark as shipped.");
      }
    });
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-foreground-muted">
        {saleIds.length} card{saleIds.length === 1 ? "" : "s"} going out in one parcel to {customer.name}. One shipping fee is charged for the whole parcel.
      </p>
      {customer.islandGroup === null && (
        <p className="rounded-lg border border-pending/30 bg-pending-bg px-3 py-2 text-sm text-pending">
          No region saved for this customer, so the fee can&apos;t be worked out automatically. Enter it below, and set their region afterwards.
        </p>
      )}
      <div>
        <label className={label}>Shipping fee{customer.islandGroup ? ` (${ISLAND_GROUP_LABELS[customer.islandGroup]})` : ""}</label>
        <Input type="number" inputMode="decimal" min={0} step="0.01" value={fee} onChange={(e) => setFee(e.target.value)} />
        <p className="mt-1 text-xs text-foreground-muted">Use 0 to waive the fee.</p>
      </div>
      {prepaidCredit > 0 && feeValid && (
        <p className="rounded-lg border border-gold/40 bg-gold/10 px-3 py-2 text-sm">
          Prepaid shipping on file: {formatCurrency(prepaidCredit)}. It covers {formatCurrency(prepaidCovers)} of this fee
          {feeNumber - prepaidCovers > 0
            ? ` - ${formatCurrency(feeNumber - prepaidCovers)} is added to what they owe.`
            : " - nothing extra is added to their balance."}
        </p>
      )}
      <div>
        <label className={label}>Note (courier, tracking...)</label>
        <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
      </div>
      {error && <p className="text-sm text-sold">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" type="button" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="gold" type="button" disabled={pending || !feeValid} onClick={submit}>
          Confirm shipped
        </Button>
      </div>
    </div>
  );
}
