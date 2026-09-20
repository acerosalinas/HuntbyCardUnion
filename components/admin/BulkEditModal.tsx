"use client";

import { useState, useTransition } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { extractErrorMessage } from "@/lib/utils";
import { BulkCardChanges, updateCardsBulk } from "@/app/admin/actions";

type PriceMode = "none" | "set" | "increase" | "decrease";
type Toggle = "none" | "on" | "off";

/** Apply one change (price / flash sale / negotiable) to every selected listing at once. Anything left on "No change" is untouched. */
export function BulkEditModal({
  open,
  cardIds,
  onClose,
  onDone,
}: {
  open: boolean;
  cardIds: string[];
  onClose: () => void;
  onDone: (updated: number) => void;
}) {
  const [priceMode, setPriceMode] = useState<PriceMode>("none");
  const [priceValue, setPriceValue] = useState("");
  const [flash, setFlash] = useState<Toggle>("none");
  const [negotiable, setNegotiable] = useState<Toggle>("none");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const reset = () => {
    setPriceMode("none");
    setPriceValue("");
    setFlash("none");
    setNegotiable("none");
    setError(null);
  };

  const close = () => {
    reset();
    onClose();
  };

  const nothingChosen = priceMode === "none" && flash === "none" && negotiable === "none";

  const apply = () => {
    setError(null);
    const changes: BulkCardChanges = {};

    if (priceMode !== "none") {
      const value = Number(priceValue);
      if (!Number.isFinite(value) || value <= 0) {
        setError(priceMode === "set" ? "Enter a price above zero." : "Enter a percentage above zero.");
        return;
      }
      if (priceMode === "decrease" && value >= 100) {
        setError("A decrease has to be under 100%.");
        return;
      }
      changes.price =
        priceMode === "set"
          ? { mode: "set", value }
          : { mode: "percent", value: priceMode === "increase" ? value : -value };
    }
    if (flash !== "none") changes.isFlashSale = flash === "on";
    if (negotiable !== "none") changes.isNegotiable = negotiable === "on";

    startTransition(async () => {
      try {
        const result = await updateCardsBulk(cardIds, changes);
        reset();
        onDone(result.updated);
      } catch (err) {
        setError(extractErrorMessage(err) ?? "Failed to update listings");
      }
    });
  };

  return (
    <Modal open={open} onClose={close} title={`Edit ${cardIds.length} listing${cardIds.length === 1 ? "" : "s"}`}>
      <div className="space-y-4">
        <p className="text-sm text-foreground-muted">Only the fields you change below are applied to every selected listing.</p>

        <div className="space-y-1.5">
          <label className="text-xs font-medium uppercase tracking-wide text-foreground-muted">Price</label>
          <div className="flex gap-2">
            <Select value={priceMode} onChange={(e) => setPriceMode(e.target.value as PriceMode)}>
              <option value="none">No change</option>
              <option value="set">Set price to</option>
              <option value="increase">Raise by %</option>
              <option value="decrease">Lower by %</option>
            </Select>
            {priceMode !== "none" && (
              <Input
                type="number"
                min="0"
                step="any"
                inputMode="decimal"
                value={priceValue}
                onChange={(e) => setPriceValue(e.target.value)}
                placeholder={priceMode === "set" ? "₱ amount" : "% amount"}
                className="max-w-36"
              />
            )}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-xs font-medium uppercase tracking-wide text-foreground-muted">Flash sale</label>
            <Select value={flash} onChange={(e) => setFlash(e.target.value as Toggle)}>
              <option value="none">No change</option>
              <option value="on">Mark as flash sale</option>
              <option value="off">Remove flash sale</option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium uppercase tracking-wide text-foreground-muted">Negotiable</label>
            <Select value={negotiable} onChange={(e) => setNegotiable(e.target.value as Toggle)}>
              <option value="none">No change</option>
              <option value="on">Buyers can Make Offer</option>
              <option value="off">No offers</option>
            </Select>
          </div>
        </div>

        {error && <p className="text-sm text-sold">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={close} disabled={pending}>
            Cancel
          </Button>
          <Button variant="gold" onClick={apply} disabled={pending || nothingChosen}>
            {pending ? "Applying..." : `Apply to ${cardIds.length}`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
