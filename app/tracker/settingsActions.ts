"use server";

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireTrackerAdmin } from "@/lib/tracker/auth";
import { normalizeOwnerTag } from "@/lib/tracker/split";
import { validateImageFile } from "@/lib/imageValidation";
import { uploadToR2 } from "@/lib/r2";
import { refresh, money, text, parse } from "./trackerHelpers";

/** Uploads a payment QR image to the public bucket and returns its URL. Nothing is saved on the settings row until saveSettings runs. */
export async function uploadTrackerQr(formData: FormData): Promise<string> {
  await requireTrackerAdmin();
  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("No file provided.");
  const { bytes, contentType } = await validateImageFile(file);
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "jpg";
  return uploadToR2(`tracker-qr/${crypto.randomUUID()}.${ext}`, bytes, contentType);
}

/** Only our own public bucket may be linked from invoices - never an arbitrary URL. */
function ownQrUrl(url: string | null): string | null {
  if (!url) return null;
  const base = process.env.R2_PUBLIC_URL;
  if (!base || !url.startsWith(base)) throw new Error("That QR image didn't come from the tracker upload - please upload it again.");
  return url;
}

export async function saveSettings(input: {
  luzonFee: number;
  visayasMindanaoFee: number;
  paymentInstructions: string;
  showAddressOnInvoice: boolean;
  strictPayments?: boolean;
  ownerLabels: { code: string; name: string; active?: boolean }[];
  gcashQrUrl: string | null;
  maribankQrUrl: string | null;
}) {
  const admin = await requireTrackerAdmin();
  const v = parse(
    z.object({
      luzonFee: money,
      visayasMindanaoFee: money,
      paymentInstructions: text(1000),
      showAddressOnInvoice: z.boolean(),
      strictPayments: z.boolean().optional(),
      gcashQrUrl: z.string().max(500).nullable(),
      maribankQrUrl: z.string().max(500).nullable(),
      ownerLabels: z
        .array(z.object({ code: text(8).min(1, "Each owner needs a short code."), name: text(40).min(1, "Each owner needs a name."), active: z.boolean().optional() }))
        .min(1, "Keep at least one owner.")
        .max(6),
    }),
    input,
  );
  const ownerLabels = v.ownerLabels.map((l) => ({ code: normalizeOwnerTag(l.code) as string, name: l.name, active: l.active !== false }));
  if (new Set(ownerLabels.map((l) => l.code)).size !== ownerLabels.length) throw new Error("Owner codes must be different from each other.");
  const row = {
    owner_id: admin.id,
    luzon_fee: v.luzonFee,
    visayas_mindanao_fee: v.visayasMindanaoFee,
    payment_instructions: v.paymentInstructions,
    show_address_on_invoice: v.showAddressOnInvoice,
    owner_labels: ownerLabels,
    gcash_qr_url: ownQrUrl(v.gcashQrUrl),
    maribank_qr_url: ownQrUrl(v.maribankQrUrl),
    updated_at: new Date().toISOString(),
  };
  const db = createAdminClient();
  let { error } = await db.from("tracker_settings").upsert({ ...row, strict_payments: v.strictPayments === true });
  // migration_live_tracker_strict_payments.sql not run yet: save everything else, and say so if strict was asked for.
  if (error && /strict_payments/i.test(error.message)) {
    if (v.strictPayments) throw new Error("Run supabase/migration_live_tracker_strict_payments.sql in the Supabase SQL editor first.");
    ({ error } = await db.from("tracker_settings").upsert(row));
  }
  if (error) throw new Error(error.message);
  refresh();
}
