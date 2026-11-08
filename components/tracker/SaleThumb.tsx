"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { catalogImageUrl } from "@/lib/pokemonCatalog";

/** Small picture of a live card (from the catalog it was picked from); tap it to preview the large one in a popup. Renders nothing for a card typed in by name. */
export function SaleThumb({ image, name }: { image: string | null; name: string }) {
  const [open, setOpen] = useState(false);
  const small = catalogImageUrl(image);
  if (!small) return null;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={`View ${name} larger`} className="shrink-0 cursor-zoom-in overflow-hidden rounded border border-card-border">
        {/* eslint-disable-next-line @next/next/no-img-element -- small catalog picture from the card image host */}
        <img src={small} alt="" loading="lazy" className="h-14 w-10 object-cover" />
      </button>
      {open && (
        <Modal open onClose={() => setOpen(false)} title={name} className="max-w-md">
          {/* eslint-disable-next-line @next/next/no-img-element -- large catalog picture from the card image host */}
          <img src={catalogImageUrl(image, "high") ?? small} alt={name} className="mx-auto max-h-[70vh] w-auto max-w-full rounded-lg object-contain" />
        </Modal>
      )}
    </>
  );
}
