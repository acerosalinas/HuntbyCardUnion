export type CardStatus = "AVAILABLE" | "PENDING" | "SOLD";
export type OfferStatus = "PENDING" | "ACCEPTED" | "DECLINED" | "SUPERSEDED";
export type QueueStatus = "WAITING" | "PROMOTED" | "CANCELLED";
export type DisputeStatus = "OPEN" | "SELLER_RESPONDED" | "UNDER_REVIEW" | "RESOLVED_REFUND" | "RESOLVED_DISMISSED";
export type DisputeReason = "ITEM_NOT_RECEIVED" | "NOT_AS_DESCRIBED" | "DAMAGED_IN_TRANSIT" | "OTHER";
export type DisputeEvidenceUploaderRole = "BUYER" | "ADMIN";

export interface CardItem {
  id: string;
  title: string;
  setName: string;
  price: number;
  /** The admin-set listing price, independent of `price` - see supabase/schema.sql for why. */
  listPrice: number;
  conditionGrade: string; // e.g. 'PSA 10', 'BGS 9.5', 'Raw NM'
  images: string[];
  sellerHandle: string;
  sellerMessenger: string; // m.me username used for the Claim Dibs redirect
  status: CardStatus;
  currentClaimant?: string | null;
  claimantId: string | null;
  claimedAt: number | null;
  isFlashSale: boolean;
  adminId: string | null;
  franchise: string | null; // slug, e.g. 'pokemon', 'one-piece' - see lib/franchises.ts
  soldAt: number | null;
  shipped: boolean;
  orderId: string | null;
  createdAt: number;
}

export interface Order {
  id: string;
  buyerHandle: string;
  buyerId: string | null;
  totalAmount: number;
  createdAt: number;
}

export interface OrderRow {
  id: string;
  buyer_handle: string;
  buyer_id: string | null;
  total_amount: number;
  created_at: string;
}

export function orderFromRow(row: OrderRow): Order {
  return {
    id: row.id,
    buyerHandle: row.buyer_handle,
    buyerId: row.buyer_id,
    totalAmount: row.total_amount,
    createdAt: new Date(row.created_at).getTime(),
  };
}

export type PlaceOrderItemResult = "claimed" | "queued" | "already_yours" | "sold" | "not_found";

export interface PlaceOrderItem {
  cardId: string;
  title?: string;
  result: PlaceOrderItemResult;
  price?: number;
  position?: number;
}

export interface PlaceOrderResult {
  orderId: string | null;
  total: number;
  items: PlaceOrderItem[];
}

export interface CardOffer {
  id: string;
  cardId: string;
  buyerHandle: string;
  buyerId: string | null;
  offeredAmount: number;
  note?: string | null;
  status: OfferStatus;
  createdAt: number;
}

export interface QueueEntry {
  id: string;
  cardId: string;
  buyerHandle: string;
  buyerId: string | null;
  status: QueueStatus;
  createdAt: number;
}

export interface DynamicLogoProps {
  src?: string;
  alt?: string;
  className?: string;
  size?: "sm" | "lg";
}

export interface Dispute {
  id: string;
  cardId: string;
  orderId: string | null;
  buyerId: string;
  sellerAdminId: string | null;
  reason: DisputeReason;
  description: string;
  status: DisputeStatus;
  resolutionNote: string | null;
  resolvedBy: string | null;
  resolvedAt: number | null;
  createdAt: number;
}

export interface DisputeRow {
  id: string;
  card_id: string;
  order_id: string | null;
  buyer_id: string;
  seller_admin_id: string | null;
  reason: DisputeReason;
  description: string;
  status: DisputeStatus;
  resolution_note: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
}

export function disputeFromRow(row: DisputeRow): Dispute {
  return {
    id: row.id,
    cardId: row.card_id,
    orderId: row.order_id,
    buyerId: row.buyer_id,
    sellerAdminId: row.seller_admin_id,
    reason: row.reason,
    description: row.description,
    status: row.status,
    resolutionNote: row.resolution_note,
    resolvedBy: row.resolved_by,
    resolvedAt: row.resolved_at ? new Date(row.resolved_at).getTime() : null,
    createdAt: new Date(row.created_at).getTime(),
  };
}

export interface DisputeEvidenceItem {
  id: string;
  disputeId: string;
  uploadedBy: string;
  uploaderRole: DisputeEvidenceUploaderRole;
  storagePath: string | null;
  fileName: string | null;
  contentType: string | null;
  note: string | null;
  createdAt: number;
  /** Populated only at render time (short-lived signed URL) - not part of the raw DB row. */
  signedUrl?: string | null;
}

export interface DisputeEvidenceRow {
  id: string;
  dispute_id: string;
  uploaded_by: string;
  uploader_role: DisputeEvidenceUploaderRole;
  storage_path: string | null;
  file_name: string | null;
  content_type: string | null;
  note: string | null;
  created_at: string;
}

export function disputeEvidenceFromRow(row: DisputeEvidenceRow): DisputeEvidenceItem {
  return {
    id: row.id,
    disputeId: row.dispute_id,
    uploadedBy: row.uploaded_by,
    uploaderRole: row.uploader_role,
    storagePath: row.storage_path,
    fileName: row.file_name,
    contentType: row.content_type,
    note: row.note,
    createdAt: new Date(row.created_at).getTime(),
  };
}

export interface SellerProfile {
  adminId: string;
  handle: string;
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
  tags: string[];
  facebookUrl: string | null;
  instagramUrl: string | null;
  messengerUsername: string | null;
  priceReviewedAt: number;
  createdAt: number;
}

export interface SellerProfileRow {
  admin_id: string;
  handle: string;
  display_name: string;
  bio: string | null;
  avatar_url: string | null;
  tags: string[];
  facebook_url: string | null;
  instagram_url: string | null;
  messenger_username: string | null;
  price_reviewed_at: string;
  created_at: string;
}

export function sellerProfileFromRow(row: SellerProfileRow): SellerProfile {
  return {
    adminId: row.admin_id,
    handle: row.handle,
    displayName: row.display_name,
    bio: row.bio,
    avatarUrl: row.avatar_url,
    tags: row.tags ?? [],
    facebookUrl: row.facebook_url,
    instagramUrl: row.instagram_url,
    messengerUsername: row.messenger_username,
    priceReviewedAt: new Date(row.price_reviewed_at).getTime(),
    createdAt: new Date(row.created_at).getTime(),
  };
}

/** Raw snake_case row shape as returned by Supabase (Postgres). */
export interface CardRow {
  id: string;
  title: string;
  set_name: string;
  price: number;
  list_price: number;
  condition_grade: string;
  images: string[];
  seller_handle: string;
  seller_messenger: string;
  status: CardStatus;
  current_claimant: string | null;
  claimant_id: string | null;
  claimed_at: string | null;
  is_flash_sale: boolean;
  admin_id: string | null;
  franchise: string | null;
  sold_at: string | null;
  shipped: boolean;
  order_id: string | null;
  created_at: string;
}

export interface OfferRow {
  id: string;
  card_id: string;
  buyer_handle: string;
  buyer_id: string | null;
  offered_amount: number;
  note: string | null;
  status: OfferStatus;
  created_at: string;
}

export interface QueueEntryRow {
  id: string;
  card_id: string;
  buyer_handle: string;
  buyer_id: string | null;
  status: QueueStatus;
  created_at: string;
}

export function cardFromRow(row: CardRow): CardItem {
  return {
    id: row.id,
    title: row.title,
    setName: row.set_name,
    price: row.price,
    listPrice: row.list_price,
    conditionGrade: row.condition_grade,
    images: row.images ?? [],
    sellerHandle: row.seller_handle,
    sellerMessenger: row.seller_messenger,
    status: row.status,
    currentClaimant: row.current_claimant,
    claimantId: row.claimant_id,
    claimedAt: row.claimed_at ? new Date(row.claimed_at).getTime() : null,
    isFlashSale: row.is_flash_sale,
    adminId: row.admin_id,
    franchise: row.franchise,
    soldAt: row.sold_at ? new Date(row.sold_at).getTime() : null,
    shipped: row.shipped,
    orderId: row.order_id,
    createdAt: new Date(row.created_at).getTime(),
  };
}

export function offerFromRow(row: OfferRow): CardOffer {
  return {
    id: row.id,
    cardId: row.card_id,
    buyerHandle: row.buyer_handle,
    buyerId: row.buyer_id,
    offeredAmount: row.offered_amount,
    note: row.note,
    status: row.status,
    createdAt: new Date(row.created_at).getTime(),
  };
}

export function queueEntryFromRow(row: QueueEntryRow): QueueEntry {
  return {
    id: row.id,
    cardId: row.card_id,
    buyerHandle: row.buyer_handle,
    buyerId: row.buyer_id,
    status: row.status,
    createdAt: new Date(row.created_at).getTime(),
  };
}
