"use server";

import { MYSTERY_MAX_PACKS } from "@/lib/mysteryPack";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertOwnsOrSuper, requireAdmin } from "@/lib/adminAuth";
import { validateImageFile } from "@/lib/imageValidation";
import { uploadToR2 } from "@/lib/r2";
import { canTransitionCardStatus } from "@/lib/cardStatus";
import { FRANCHISES } from "@/lib/franchises";
import { CardItem, CardRow, cardFromRow } from "@/types/marketplace";
import { extractErrorMessage } from "@/lib/utils";
import { revalidateAdmin, getCardOwner } from "./actionHelpers";

export async function deleteCard(cardId: string) {
  const admin = await requireAdmin();
  const supabase = createAdminClient();
  assertOwnsOrSuper(admin, await getCardOwner(supabase, cardId));

  const { error } = await supabase.from("cards").delete().eq("id", cardId);
  if (error) throw new Error(error.message);
  revalidateAdmin();
}

const MAX_BULK_CARDS = 200;

/** Fetches the given cards and checks the calling admin owns every one (super admins own all) - nothing is changed unless all of them pass, so a mixed selection can't be half-applied. */
async function getOwnedCards<T extends { id: string; admin_id: string | null }>(
  supabase: ReturnType<typeof createAdminClient>,
  admin: Awaited<ReturnType<typeof requireAdmin>>,
  cardIds: string[],
  columns: string,
): Promise<T[]> {
  const ids = [...new Set(cardIds)];
  if (ids.length === 0) throw new Error("No listings selected.");
  if (ids.length > MAX_BULK_CARDS) throw new Error(`Select at most ${MAX_BULK_CARDS} listings at a time.`);

  const { data, error } = await supabase.from("cards").select(`id, admin_id, ${columns}`).in("id", ids);
  if (error) throw new Error(error.message);
  const cards = (data ?? []) as unknown as T[];
  if (cards.length !== ids.length) throw new Error("Some of these listings no longer exist - refresh and try again.");
  for (const card of cards) assertOwnsOrSuper(admin, card.admin_id);
  return cards;
}

/**
 * Removes many listings in one go. Refuses if any selected card still has a
 * buyer who hasn't paid yet - deleting a card also deletes its claims, which
 * would silently wipe that buyer's pending order out from under them.
 */
export async function deleteCards(cardIds: string[]) {
  const admin = await requireAdmin();
  const supabase = createAdminClient();
  const cards = await getOwnedCards<{ id: string; admin_id: string | null }>(supabase, admin, cardIds, "title");

  const ids = cards.map((c) => c.id);
  const { data: pendingClaims, error: pendingError } = await supabase
    .from("card_claims")
    .select("card_id")
    .in("card_id", ids)
    .eq("status", "PENDING");
  if (pendingError) throw new Error(pendingError.message);
  const blocked = new Set((pendingClaims ?? []).map((c) => c.card_id as string));
  if (blocked.size > 0) {
    throw new Error(
      `${blocked.size} of the selected listing${blocked.size === 1 ? " has" : "s have"} a buyer with a pending payment - confirm or cancel those first, or unselect them.`,
    );
  }

  const { error } = await supabase.from("cards").delete().in("id", ids);
  if (error) throw new Error(error.message);
  revalidateAdmin();
  return { removed: ids.length };
}

export interface BulkCardChanges {
  /** How to change the price - omit to leave prices alone. "set" replaces it, "percent" raises (positive) or lowers (negative) it. */
  price?: { mode: "set"; value: number } | { mode: "percent"; value: number };
  isFlashSale?: boolean;
  isNegotiable?: boolean;
}

/** Applies the same change to many listings - price (set / +-%), flash sale, negotiable. Anything left out of `changes` is untouched. */
export async function updateCardsBulk(cardIds: string[], changes: BulkCardChanges) {
  const admin = await requireAdmin();
  const supabase = createAdminClient();
  if (changes.price === undefined && changes.isFlashSale === undefined && changes.isNegotiable === undefined) {
    throw new Error("Choose at least one thing to change.");
  }
  const cards = await getOwnedCards<{ id: string; admin_id: string | null; price: number }>(supabase, admin, cardIds, "price");

  // Work out every new price first so one bad result (zero or negative)
  // fails the whole batch before anything is written.
  const newPrices = new Map<string, number>();
  if (changes.price) {
    for (const card of cards) {
      const next =
        changes.price.mode === "set"
          ? changes.price.value
          : Math.round(card.price * (1 + changes.price.value / 100) * 100) / 100;
      if (!Number.isFinite(next) || next <= 0) throw new Error("That would make a price zero or negative.");
      newPrices.set(card.id, next);
    }
  }

  const results = await Promise.all(
    cards.map((card) => {
      const update: Record<string, unknown> = {};
      const nextPrice = newPrices.get(card.id);
      // list_price moves with price, same as editing one listing (see updateCard).
      if (nextPrice !== undefined) {
        update.price = nextPrice;
        update.list_price = nextPrice;
      }
      if (changes.isFlashSale !== undefined) update.is_flash_sale = changes.isFlashSale;
      if (changes.isNegotiable !== undefined) update.is_negotiable = changes.isNegotiable;
      return supabase.from("cards").update(update).eq("id", card.id);
    }),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) throw new Error(failed.error.message);

  revalidateAdmin();
  return { updated: cards.length };
}

export async function uploadCardImages(formData: FormData): Promise<string[]> {
  await requireAdmin();
  const files = formData.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) return [];

  const urls: string[] = [];

  for (const file of files) {
    const { bytes, contentType } = await validateImageFile(file);

    const ext = file.name.split(".").pop() || "jpg";
    const path = `${crypto.randomUUID()}.${ext}`;

    const url = await uploadToR2(path, bytes, contentType);
    urls.push(url);
  }

  return urls;
}

/** Uploads a seller's avatar image, reusing the same public R2 bucket as card photos. */
export async function uploadAvatarImage(formData: FormData): Promise<string> {
  await requireAdmin();
  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("No file provided.");

  const { bytes, contentType } = await validateImageFile(file);

  const ext = file.name.split(".").pop() || "jpg";
  const path = `avatars/${crypto.randomUUID()}.${ext}`;

  return uploadToR2(path, bytes, contentType);
}

/** Uploads a seller's GCash/bank payment QR code, reusing the same public R2 bucket as avatars. */
export async function uploadPaymentQrImage(formData: FormData): Promise<string> {
  await requireAdmin();
  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error("No file provided.");

  const { bytes, contentType } = await validateImageFile(file);

  const ext = file.name.split(".").pop() || "jpg";
  const path = `payment-qr/${crypto.randomUUID()}.${ext}`;

  return uploadToR2(path, bytes, contentType);
}

export interface CreateCardInput {
  title: string;
  setName: string;
  price: number;
  conditionGrade: string;
  rarity: string;
  /** Pokemon TCG energy type (see lib/pokemonType.ts) - null for every non-Pokemon card. */
  pokemonType: string | null;
  /** 'CARD' (default), 'SEALED' (see lib/sealedType.ts) or 'MYSTERY' (a Fun Mystery Pack, see lib/mysteryPack.ts - quantity is the number of numbered packs). The form is responsible for setting conditionGrade/rarity to the fixed placeholder values for a sealed item; this action just persists whatever it's given. */
  productType: "CARD" | "SEALED" | "MYSTERY";
  sealedType: string | null;
  images: string[];
  sellerHandle: string;
  sellerMessenger: string;
  isFlashSale: boolean;
  /** Whether buyers can Make Offer on this listing - see cards.is_negotiable. */
  isNegotiable: boolean;
  franchise: string;
  quantity: number;
  /** The shared Pokemon catalog card this listing was picked from, when it was (see cards.catalog_card_id). */
  catalogCardId?: string | null;
}

/** True when a save failed only because migration_card_catalog_link.sql has not been run yet. */
function missingCatalogColumn(error: { message: string } | null): boolean {
  return Boolean(error && /catalog_card_id/i.test(error.message));
}

/** 0 is a valid, meaningful quantity now (an explicitly sold-out listing - see updateCard) - only truly invalid input (blank/NaN) falls back to 1, same default as before. */
function normalizeQuantity(raw: number): number {
  if (!Number.isFinite(raw)) return 1;
  return Math.max(0, Math.round(raw));
}

/**
 * Next.js blanks the message of any error thrown out of a server action in production ("Minified React error
 * #441"), which left the listing form unable to say why a save failed. The two listing saves therefore return the
 * reason as data instead - the form shows it, and the same message is still written to the server log.
 */
async function asResult(label: string, run: () => Promise<void>): Promise<{ error?: string }> {
  try {
    await run();
    return {};
  } catch (err) {
    console.error(`[${label}]`, err);
    return { error: extractErrorMessage(err) ?? "Failed to save listing" };
  }
}

export async function createCard(input: CreateCardInput): Promise<{ error?: string }> {
  return asResult("createCard", () => createCardOrThrow(input));
}

export async function updateCard(cardId: string, input: CreateCardInput): Promise<{ error?: string }> {
  return asResult("updateCard", () => updateCardOrThrow(cardId, input));
}

/** A Fun Mystery Pack is 1-10 numbered packs at one price and is never negotiated - anything else is refused. */
function assertMysteryRules(input: CreateCardInput, quantity: number) {
  if (input.productType !== "MYSTERY") return;
  if (quantity < 1 || quantity > MYSTERY_MAX_PACKS) throw new Error(`A Fun Mystery Pack has 1 to ${MYSTERY_MAX_PACKS} packs.`);
}

async function createCardOrThrow(input: CreateCardInput) {
  const admin = await requireAdmin();
  const supabase = createAdminClient();
  const quantity = normalizeQuantity(input.quantity);
  if (quantity < 1) throw new Error("A new listing needs at least 1 in stock.");
  assertMysteryRules(input, quantity);
  const row: Record<string, unknown> = {
    title: input.title,
    set_name: input.setName,
    price: input.price,
    list_price: input.price,
    condition_grade: input.conditionGrade,
    rarity: input.rarity,
    pokemon_type: input.pokemonType,
    product_type: input.productType,
    sealed_type: input.sealedType,
    images: input.images,
    seller_handle: input.sellerHandle,
    seller_messenger: input.sellerMessenger,
    is_flash_sale: input.isFlashSale,
    is_negotiable: input.productType === "MYSTERY" ? false : input.isNegotiable,
    franchise: input.franchise,
    admin_id: admin.id,
    quantity,
    quantity_available: quantity,
  };
  let { error } = await supabase.from("cards").insert(input.catalogCardId ? { ...row, catalog_card_id: input.catalogCardId } : row);
  if (missingCatalogColumn(error)) ({ error } = await supabase.from("cards").insert(row));
  if (error) throw new Error(error.message);
  revalidateAdmin();
}

async function updateCardOrThrow(cardId: string, input: CreateCardInput) {
  const admin = await requireAdmin();
  const supabase = createAdminClient();
  assertOwnsOrSuper(admin, await getCardOwner(supabase, cardId));

  const { data: existing, error: existingError } = await supabase
    .from("cards")
    .select("status, quantity, quantity_available")
    .eq("id", cardId)
    .single();
  if (existingError || !existing) throw new Error(existingError?.message ?? "Card not found");

  const quantity = normalizeQuantity(input.quantity);
  assertMysteryRules(input, quantity);
  if (input.productType === "MYSTERY") {
    // Packs already picked keep their numbers, so the pack count can't drop below the highest one taken.
    const { data: taken } = await supabase.from("card_claims").select("pack_number").eq("card_id", cardId).in("status", ["PENDING", "SOLD"]).not("pack_number", "is", null);
    const highest = Math.max(0, ...(taken ?? []).map((t) => Number(t.pack_number)));
    if (quantity < highest) throw new Error(`Pack #${highest} is already taken, so there must be at least ${highest} packs.`);
  }
  const claimed = existing.quantity - existing.quantity_available;
  if (quantity < claimed) {
    throw new Error(`Quantity can't be less than ${claimed} - that many units are already claimed.`);
  }
  // 0 is allowed here (claimed is always 0 too in that case, since the
  // check above already rejects going below however many units are
  // claimed) - quantityAvailable then also lands on 0, which the line below
  // already turns into SOLD, same as running out through a real purchase.
  const quantityAvailable = quantity - claimed;
  const status = existing.status === "DRAFT" ? "DRAFT" : quantityAvailable > 0 ? "AVAILABLE" : "SOLD";

  const changes: Record<string, unknown> = {
      title: input.title,
      set_name: input.setName,
      price: input.price,
      // Editing a listing resets the baseline too - whatever price admin
      // explicitly saves here is the new "real" listed price, same as at
      // creation. Only acceptOffer is meant to create a temporary gap
      // between price and list_price.
      list_price: input.price,
      condition_grade: input.conditionGrade,
      rarity: input.rarity,
      pokemon_type: input.pokemonType,
      product_type: input.productType,
      sealed_type: input.sealedType,
      images: input.images,
      seller_handle: input.sellerHandle,
      seller_messenger: input.sellerMessenger,
      is_flash_sale: input.isFlashSale,
      is_negotiable: input.productType === "MYSTERY" ? false : input.isNegotiable,
      franchise: input.franchise,
      quantity,
      quantity_available: quantityAvailable,
      status,
  };
  let { error } = await supabase.from("cards").update(input.catalogCardId ? { ...changes, catalog_card_id: input.catalogCardId } : changes).eq("id", cardId);
  if (missingCatalogColumn(error)) ({ error } = await supabase.from("cards").update(changes).eq("id", cardId));
  if (error) throw new Error(error.message);
  revalidateAdmin();
}

// ---------------------------------------------------------------------------
// Bulk Upload / Rapid Fill (app/admin/(dashboard)/inventory/bulk-upload).
// Uploading photos happens through the existing uploadCardImages() above;
// filling in a card's real details during Rapid Fill happens through the
// existing updateCard() above (it never touches status, so a draft stays a
// draft while its fields get overwritten) - these two actions only cover
// creating the placeholder rows and publishing them once ready.
// ---------------------------------------------------------------------------

const DRAFT_PLACEHOLDER_PRICE = 0.01;

/** One placeholder DRAFT row per uploaded image URL, owned by the calling admin. Never visible to buyers - see the "cards are publicly readable" RLS policy in supabase/schema.sql. */
export async function createDraftCards(imageUrls: string[]): Promise<CardItem[]> {
  const admin = await requireAdmin();
  if (imageUrls.length === 0) return [];

  const supabase = createAdminClient();
  const { data: profile } = await supabase
    .from("seller_profiles")
    .select("handle, messenger_username, tags")
    .eq("admin_id", admin.id)
    .maybeSingle();

  const rows = imageUrls.map((url) => ({
    title: "Untitled card",
    set_name: "Unknown Set",
    price: DRAFT_PLACEHOLDER_PRICE,
    list_price: DRAFT_PLACEHOLDER_PRICE,
    condition_grade: "Raw NM",
    images: [url],
    seller_handle: profile?.handle ? `@${profile.handle}` : admin.email,
    seller_messenger: profile?.messenger_username ?? "",
    franchise: profile?.tags?.[0] ?? FRANCHISES[0].slug,
    is_flash_sale: false,
    status: "DRAFT" as const,
    admin_id: admin.id,
  }));

  const { data, error } = await supabase.from("cards").insert(rows).select("*");
  if (error) throw new Error(error.message);
  revalidateAdmin();
  return ((data as CardRow[] | null) ?? []).map(cardFromRow);
}

/** Publishes DRAFT -> AVAILABLE for the given card ids. Ignores any id that isn't actually a DRAFT the caller owns (or any draft, for a super admin) - see lib/cardStatus.ts. */
export async function publishDrafts(cardIds: string[]): Promise<{ published: number }> {
  const admin = await requireAdmin();
  if (cardIds.length === 0) return { published: 0 };

  const supabase = createAdminClient();
  const { data, error: fetchError } = await supabase
    .from("cards")
    .select("id, status, admin_id")
    .in("id", cardIds);
  if (fetchError) throw new Error(fetchError.message);

  const publishableIds = ((data ?? []) as { id: string; status: string; admin_id: string | null }[])
    .filter((row) => admin.role === "SUPER_ADMIN" || row.admin_id === admin.id)
    .filter((row) => canTransitionCardStatus(row.status as CardItem["status"], "AVAILABLE"))
    .map((row) => row.id);

  if (publishableIds.length === 0) return { published: 0 };

  const { error } = await supabase.from("cards").update({ status: "AVAILABLE" }).in("id", publishableIds);
  if (error) throw new Error(error.message);
  revalidateAdmin();
  return { published: publishableIds.length };
}
