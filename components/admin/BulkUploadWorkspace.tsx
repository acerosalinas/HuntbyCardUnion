"use client";

import { useState } from "react";
import { BulkUploadDropzone } from "@/components/admin/BulkUploadDropzone";
import { RapidFillQueue } from "@/components/admin/RapidFillQueue";
import { CardItem } from "@/types/marketplace";

/** Drop zone until there's at least one draft to fill in, then the Rapid Fill queue editor. */
export function BulkUploadWorkspace({ initialDrafts }: { initialDrafts: CardItem[] }) {
  const [drafts, setDrafts] = useState(initialDrafts);

  if (drafts.length === 0) {
    return <BulkUploadDropzone onCreated={setDrafts} />;
  }

  return <RapidFillQueue initialDrafts={drafts} />;
}
