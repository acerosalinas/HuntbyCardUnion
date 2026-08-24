export type CardStatus = "DRAFT" | "AVAILABLE" | "PENDING" | "SOLD";
export type OfferStatus = "PENDING" | "ACCEPTED" | "DECLINED" | "SUPERSEDED";
export type QueueStatus = "WAITING" | "PROMOTED" | "CANCELLED";
export type DisputeStatus = "OPEN" | "SELLER_RESPONDED" | "UNDER_REVIEW" | "RESOLVED_REFUND" | "RESOLVED_DISMISSED";
export type DisputeReason = "ITEM_NOT_RECEIVED" | "NOT_AS_DESCRIBED" | "DAMAGED_IN_TRANSIT" | "OTHER";
export type DisputeEvidenceUploaderRole = "BUYER" | "ADMIN";
export type NotificationType =
  | "offer_received"
  | "offer_countered"
  | "card_claimed"
  | "queue_promoted"
  | "payment_confirmed"
  | "listing_cancelled"
  | "dispute_opened"
  | "dispute_withdrawn"
  | "dispute_response"
  | "dispute_under_review"
  | "dispute_resolved"
  | "claim_cancelled_by_buyer"
  | "review_received";

export interface CardItem {
  id: string;
  title: string;
  setName: string;
  price: number;
  /** The admin-set listing price, independent of `price` - see supabase/schema.sql for why. */
  listPrice: number;
  conditionGrade: string; // e.g. 'PSA 10', 'BGS 9.5', 'Raw NM'
  rarity: string; // fixed dropdown vocabulary - see lib/rarity.ts
  /** Pokemon TCG energy type (see lib/pokemonType.ts) - null for every non-Pokemon card. */
  pokemonType: string | null;
  images: string[];
  sellerHandle: string;
  sellerMessenger: string; // m.me username used for the Claim Dibs redirect
  status: CardStatus;
  /** Total units ever listed (admin-editable). */
  quantity: number;
  /** Units not yet claimed by anyone - see card_claims for who holds the rest. */
  quantityAvailable: number;
  isFlashSale: boolean;
  adminId: string | null;
  franchise: string | null; // slug, e.g. 'pokemon', 'one-piece' - see lib/franchises.ts
  createdAt: number;
}

export type ClaimStatus = "PENDING" | "SOLD" | "CANCELLED";

/** Chosen per card at Add to Cart, not once per order - see supabase/schema.sql's card_claims/dibs_queue tables. */
export type FulfillmentMethod = "SHIP" | "STASH";

/** One buyer's claim on some quantity of a card's stock - see supabase/schema.sql's card_claims table. */
export interface CardClaim {
  id: string;
  cardId: string;
  orderId: string | null;
  buyerHandle: string;
  buyerId: string | null;
  quantity: number;
  unitPrice: number;
  status: ClaimStatus;
  claimedAt: number;
  confirmedAt: number | null;
  shipped: boolean;
  /** Buyer-set via mark_claim_received() - the final stage of the My Dibs order tracker, ahead of leaving a review. */
  receivedAt: number | null;
  fulfillmentMethod: FulfillmentMethod;
}

export interface CardClaimRow {
  id: string;
  card_id: string;
  order_id: string | null;
  buyer_handle: string;
  buyer_id: string | null;
  quantity: number;
  unit_price: number;
  status: ClaimStatus;
  claimed_at: string;
  confirmed_at: string | null;
  shipped: boolean;
  received_at: string | null;
  fulfillment_method: FulfillmentMethod;
}

export function cardClaimFromRow(row: CardClaimRow): CardClaim {
  return {
    id: row.id,
    cardId: row.card_id,
    orderId: row.order_id,
    buyerHandle: row.buyer_handle,
    buyerId: row.buyer_id,
    quantity: row.quantity,
    unitPrice: row.unit_price,
    status: row.status,
    claimedAt: new Date(row.claimed_at).getTime(),
    confirmedAt: row.confirmed_at ? new Date(row.confirmed_at).getTime() : null,
    shipped: row.shipped,
    receivedAt: row.received_at ? new Date(row.received_at).getTime() : null,
    fulfillmentMethod: row.fulfillment_method,
  };
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

export type PlaceOrderItemResult = "claimed" | "queued" | "not_found";

export interface PlaceOrderItem {
  cardId: string;
  title?: string;
  result: PlaceOrderItemResult;
  price?: number;
  quantity?: number;
  position?: number;
}

export interface PlaceOrderCartItem {
  cardId: string;
  quantity: number;
  fulfillmentMethod: FulfillmentMethod;
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
  requestedQuantity: number;
  fulfillmentMethod: FulfillmentMethod;
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
  claimId: string | null;
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
  claim_id: string | null;
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
    claimId: row.claim_id,
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

/** A buyer's rating + optional comment on one specific purchase (card_claims row) - public, shown on the seller's profile. */
export interface Review {
  id: string;
  claimId: string;
  cardId: string;
  sellerAdminId: string | null;
  buyerId: string;
  buyerHandle: string;
  rating: number;
  comment: string | null;
  createdAt: number;
}

export interface ReviewRow {
  id: string;
  claim_id: string;
  card_id: string;
  seller_admin_id: string | null;
  buyer_id: string;
  buyer_handle: string;
  rating: number;
  comment: string | null;
  created_at: string;
}

export function reviewFromRow(row: ReviewRow): Review {
  return {
    id: row.id,
    claimId: row.claim_id,
    cardId: row.card_id,
    sellerAdminId: row.seller_admin_id,
    buyerId: row.buyer_id,
    buyerHandle: row.buyer_handle,
    rating: row.rating,
    comment: row.comment,
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
  /** Seconds each card shows for in Live Mode on this seller's storefront - seller-controlled, 1-30. */
  liveModeSeconds: number;
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
  live_mode_seconds: number;
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
    liveModeSeconds: row.live_mode_seconds,
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
  rarity: string;
  pokemon_type: string | null;
  images: string[];
  seller_handle: string;
  seller_messenger: string;
  status: CardStatus;
  quantity: number;
  quantity_available: number;
  is_flash_sale: boolean;
  admin_id: string | null;
  franchise: string | null;
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
  requested_quantity: number;
  fulfillment_method: FulfillmentMethod;
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
    rarity: row.rarity,
    pokemonType: row.pokemon_type,
    images: row.images ?? [],
    sellerHandle: row.seller_handle,
    sellerMessenger: row.seller_messenger,
    status: row.status,
    quantity: row.quantity,
    quantityAvailable: row.quantity_available,
    isFlashSale: row.is_flash_sale,
    adminId: row.admin_id,
    franchise: row.franchise,
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
    requestedQuantity: row.requested_quantity,
    fulfillmentMethod: row.fulfillment_method,
    status: row.status,
    createdAt: new Date(row.created_at).getTime(),
  };
}

export interface AppNotification {
  id: string;
  recipientId: string;
  type: NotificationType;
  title: string;
  body: string | null;
  link: string | null;
  /** null = unread. */
  readAt: number | null;
  createdAt: number;
}

export interface NotificationRow {
  id: string;
  recipient_id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

export function notificationFromRow(row: NotificationRow): AppNotification {
  return {
    id: row.id,
    recipientId: row.recipient_id,
    type: row.type,
    title: row.title,
    body: row.body,
    link: row.link,
    readAt: row.read_at ? new Date(row.read_at).getTime() : null,
    createdAt: new Date(row.created_at).getTime(),
  };
}
