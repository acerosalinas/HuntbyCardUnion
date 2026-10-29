"use client";

import { ReactNode, useState } from "react";
import { ExternalLink, ImageOff } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { cn } from "@/lib/utils";

interface Props {
  /** The full, untruncated title - what you need to read to verify the card. */
  title: string;
  subtitle?: ReactNode;
  images: string[];
  onClose: () => void;
  /** Buttons shown under the photo (e.g. Fulfilled / Not fulfilled). */
  children?: ReactNode;
}

/** A large view of a card photo (with its full title) so it can actually be checked, instead of a thumbnail. */
export function ImageLightbox({ title, subtitle, images, onClose, children }: Props) {
  const [index, setIndex] = useState(0);
  const current = images[Math.min(index, images.length - 1)];

  return (
    <Modal open onClose={onClose} title={title} className="max-w-3xl">
      <div className="space-y-3">
        {subtitle && <div className="text-sm text-foreground-muted">{subtitle}</div>}

        <div className="flex min-h-48 items-center justify-center rounded-xl border border-card-border bg-foreground/5 p-2">
          {current ? (
            // eslint-disable-next-line @next/next/no-img-element -- buyer-uploaded / card photo, shown at its natural size
            <img src={current} alt={title} className="max-h-[60vh] w-auto max-w-full rounded-lg object-contain" />
          ) : (
            <div className="flex flex-col items-center gap-1 py-10 text-foreground-muted">
              <ImageOff size={28} />
              <span className="text-sm">No photo</span>
            </div>
          )}
        </div>

        {images.length > 1 && (
          <div className="flex flex-wrap gap-2">
            {images.map((src, i) => (
              <button
                key={src + i}
                type="button"
                onClick={() => setIndex(i)}
                aria-label={`Show photo ${i + 1}`}
                className={cn("h-14 w-14 overflow-hidden rounded-lg border-2", i === index ? "border-gold" : "border-card-border opacity-70 hover:opacity-100")}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- thumbnail strip */}
                <img src={src} alt="" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {children}
          {current && (
            <a href={current} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-xs text-foreground-muted hover:text-gold">
              <ExternalLink size={12} /> Open original
            </a>
          )}
        </div>
      </div>
    </Modal>
  );
}
