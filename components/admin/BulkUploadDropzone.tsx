"use client";

import { useRef, useState } from "react";
import { Camera, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn, extractErrorMessage } from "@/lib/utils";
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
    const files = Array.from(fileList).slice(0, MAX_FILES);
    setError(
      fileList.length > MAX_FILES ? `Only the first ${MAX_FILES} images were used - that's the limit per batch.` : null,
    );

    setUploading(true);
    try {
      setProgress(`Uploading ${files.length} photo${files.length === 1 ? "" : "s"}...`);
      const formData = new FormData();
      files.forEach((file) => formData.append("files", file));
      const urls = await uploadCardImages(formData);

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
            Up to {MAX_FILES} images at once - JPG, PNG, WEBP, GIF. One photo per card.
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
          accept="image/png,image/jpeg,image/webp,image/gif"
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
