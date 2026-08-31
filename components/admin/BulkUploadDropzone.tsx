"use client";

import { useRef, useState } from "react";
import { Camera, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn, extractErrorMessage } from "@/lib/utils";
import { checkImageTypeClientSide, ACCEPTED_IMAGE_ACCEPT_ATTR } from "@/lib/imageAccept";
import { normalizeImageFiles } from "@/lib/imageNormalize";
import { uploadCardImages, createDraftCards } from "@/app/admin/actions";
import { CardItem } from "@/types/marketplace";

const MAX_FILES = 30;

export function BulkUploadDropzone({ onCreated }: { onCreated: (drafts: CardItem[]) => void }) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const capped = Array.from(fileList).slice(0, MAX_FILES);

    setUploading(true);
    try {
      setProgress("Preparing photos...");
      // Downscales/recompresses (and converts HEIC/HEIF to JPEG) before the
      // format/size check - see lib/imageNormalize.ts.
      const normalized = await normalizeImageFiles(capped);

      // Skip anything still the wrong format after normalization rather
      // than blocking the whole batch on one bad file - a directly-awaited
      // Server Action's thrown error is redacted in production anyway, so
      // this is also the only way to surface *which* file and why.
      const files: File[] = [];
      const skipped: string[] = [];
      for (const file of normalized) {
        const typeError = checkImageTypeClientSide(file);
        if (typeError) skipped.push(typeError);
        else files.push(file);
      }

      const notices: string[] = [];
      if (fileList.length > MAX_FILES) notices.push(`Only the first ${MAX_FILES} images were used - that's the limit per batch.`);
      notices.push(...skipped);
      setError(notices.length > 0 ? notices.join(" ") : null);

      if (files.length === 0) return;

      // One Server Action call per file, not one call for the whole batch -
      // Vercel's 4.5MB request body limit is on the total request, so
      // bundling 30 photos into one request would still blow past it even
      // with each individual photo now comfortably under the cap.
      const urls: string[] = [];
      for (let i = 0; i < files.length; i++) {
        setProgress(`Uploading photo ${i + 1} of ${files.length}...`);
        const formData = new FormData();
        formData.append("files", files[i]);
        urls.push(...(await uploadCardImages(formData)));
      }

      setProgress("Creating drafts...");
      const drafts = await createDraftCards(urls);
      onCreated(drafts);
    } catch (err) {
      setError(extractErrorMessage(err) ?? "Upload failed");
    } finally {
      setUploading(false);
      setProgress(null);
      if (inputRef.current) inputRef.current.value = "";
      if (cameraInputRef.current) cameraInputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-2">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          handleFiles(e.dataTransfer.files);
        }}
        className={cn(
          "flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-16 text-center transition-colors",
          dragging ? "border-gold bg-gold/5" : "border-card-border",
        )}
      >
        <UploadCloud size={32} className="text-foreground-muted" />
        <div>
          <p className="font-medium text-foreground">Drag & drop card photos here</p>
          <p className="text-sm text-foreground-muted">
            Up to {MAX_FILES} images at once, any common photo format. One photo per card.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button type="button" variant="gold" disabled={uploading} onClick={() => inputRef.current?.click()}>
            {uploading ? (progress ?? "Uploading...") : "Choose Photos"}
          </Button>
          <Button type="button" variant="outline" disabled={uploading} onClick={() => cameraInputRef.current?.click()}>
            <Camera size={15} />
            Scan with Camera
          </Button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_IMAGE_ACCEPT_ATTR}
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        {/* No `multiple` - mobile camera capture hands back one photo per scan; admins scan again for the next card. `capture` is ignored (harmlessly falls back to the file picker) on desktop browsers that don't support it. */}
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>
      {error && <p className="text-sm text-sold">{error}</p>}
    </div>
  );
}
