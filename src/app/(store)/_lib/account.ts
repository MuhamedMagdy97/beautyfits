import { StoreApiError, storePost } from "./api";
import type { Lang } from "./lang";

/**
 * Shapes the customer account screens read (TASK-060; API "TASK-028",
 * "TASK-030" … "TASK-038", "TASK-045", "TASK-046" Amendments) and their small
 * helpers. Money is integer piastres; the API decides every amount, status
 * and eligibility.
 */

export interface OrderListItem {
  id: string;
  orderNumber: string;
  status: string;
  total: number;
  codAmount: number;
  itemCount: number;
  createdAt: string;
}

export interface OrderLine {
  /** The order line (TASK-060), for return requests and reviews. */
  id: string;
  variantId: string;
  sku: string;
  name: string;
  variantName: string | null;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
  lineTotal: number;
}

export interface AddressSnapshot {
  recipientName: string;
  phone: string;
  governorate: { nameAr: string; nameEn: string };
  area: { nameAr: string; nameEn: string };
  city: string | null;
  street: string;
  building: string | null;
  floor: string | null;
  apartment: string | null;
  landmark: string | null;
}

export interface Revision {
  id: string;
  status: string;
  oldTotal: number;
  newTotal: number;
  expiresAt: string;
  proposed: {
    items: Omit<OrderLine, "id">[];
    discountDropped: boolean;
    shippingFee: number;
    total: number;
    walletAmount: number;
    codAmount: number;
    shippingAddress: AddressSnapshot;
  };
}

export interface CustomerShipment {
  status: string;
  company: { name: string };
  trackingNumber: string | null;
  shippedAt: string;
  deliveredAt: string | null;
  cancellationRequestedAt: string | null;
  returnedAt: string | null;
  events: { type: string; at: string }[];
}

export interface CustomerOrder {
  id: string;
  orderNumber: string;
  status: string;
  subtotal: number;
  discountTotal: number;
  shippingFee: number;
  total: number;
  walletAmount: number;
  codAmount: number;
  items: OrderLine[];
  discount: { code: string | null; name: string | null } | null;
  shippingAddress: AddressSnapshot;
  statusHistory: { status: string; at: string }[];
  pendingRevision: Revision | null;
  shipments: CustomerShipment[];
  createdAt: string;
}

export interface ReturnRequest {
  id: string;
  returnNumber: string;
  orderId: string;
  orderNumber: string;
  status: string;
  claimType: string;
  reason: string;
  items: {
    id: string;
    orderItemId: string;
    productName: { ar: string; en: string };
    variantName: { ar: string | null; en: string | null } | null;
    orderedQuantity: number;
    requestedQuantity: number;
  }[];
  evidence: { mediaAssetId: string }[];
  rejectionReason: string | null;
  pickup: {
    shippingCompany: { name: string };
    trackingNumber: string | null;
    feePayer: string;
  } | null;
  /** Set once the return is completed (TASK-041): the wallet refund, piastres. */
  completedAt: string | null;
  refundTotal: number | null;
  createdAt: string;
}

export interface Wallet {
  balance: number;
  reserved: number;
  available: number;
}

export interface WalletTransaction {
  id: string;
  type: string;
  signedAmount: number;
  referenceType: string | null;
  referenceId: string | null;
  createdAt: string;
}

export interface CustomerNotification {
  id: string;
  title: string;
  body: string;
  deepLink: { type: string; id: string } | null;
  readAt: string | null;
  createdAt: string;
}

export interface MarketingConsents {
  email: { optedIn: boolean; changedAt: string | null };
  whatsapp: { optedIn: boolean; changedAt: string | null };
}

export const CLAIM_TYPES = [
  "DAMAGED",
  "WRONG_ITEM",
  "DEFECTIVE",
  "EXPIRED",
  "MISSING_ITEM",
  "OTHER",
] as const;

/**
 * Which actions to offer for an order status (API §15 Order Rules, "TASK-032"
 * and "TASK-036" Amendments). Offering is all the website decides: the API
 * checks every request again and its refusal is shown as is.
 */
export function orderActions(status: string) {
  return {
    cancel: [
      "PENDING_CONFIRMATION",
      "NEW",
      "CONFIRMED",
      "PREPARING",
      "READY_FOR_SHIPMENT",
    ].includes(status),
    stopDelivery: status === "SHIPPED",
    modify: ["PENDING_CONFIRMATION", "NEW", "CONFIRMED"].includes(status),
    afterDelivery: status === "DELIVERED",
  };
}

/** Where a notification leads (API "TASK-045 Amendments": `deepLink`). */
export function notificationHref(link: CustomerNotification["deepLink"]): string | null {
  if (link?.type === "ORDER") {
    return `/account/orders/${link.id}`;
  }
  if (link?.type === "PRODUCT") {
    return `/products/${link.id}`;
  }
  return null;
}

/** An order-time `{ ar, en }` snapshot name in the page language. */
export function snapshotName(
  name: { ar: string | null; en: string | null } | null,
  lang: Lang,
): string | null {
  return name ? (name[lang] ?? name.ar ?? name.en) : null;
}

/** One line of an address snapshot, in the page language. */
export function addressLine(address: AddressSnapshot, lang: Lang): string {
  const place = (p: { nameAr: string; nameEn: string }) => (lang === "ar" ? p.nameAr : p.nameEn);
  return [
    address.street,
    address.building,
    address.floor,
    address.apartment,
    address.city,
    place(address.area),
    place(address.governorate),
  ]
    .filter(Boolean)
    .join(lang === "ar" ? "، " : ", ");
}

export function formatDate(iso: string, lang: Lang, withTime = false): string {
  return new Intl.DateTimeFormat(lang === "ar" ? "ar-EG" : "en-EG", {
    dateStyle: "medium",
    ...(withTime ? { timeStyle: "short" } : {}),
    timeZone: "Africa/Cairo",
  }).format(new Date(iso));
}

/**
 * Uploads a return photo (API §28, "TASK-037 Amendments"): start, send the
 * bytes with exactly the returned headers, complete. Returns `mediaAssetId`.
 */
export async function uploadReturnPhoto(file: File): Promise<string> {
  const started = await storePost<{
    mediaAssetId: string;
    upload: { method: string; url: string; headers: Record<string, string> };
  }>("/api/v1/files/upload-init", {
    purpose: "RETURN_EVIDENCE",
    filename: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
  });
  let response: Response;
  try {
    response = await fetch(started.upload.url, {
      method: started.upload.method,
      headers: started.upload.headers,
      body: file,
    });
  } catch {
    throw new StoreApiError(0, "NETWORK_ERROR");
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { code?: string; details?: Record<string, unknown> };
    } | null;
    throw new StoreApiError(
      response.status,
      body?.error?.code ?? "INTERNAL_ERROR",
      body?.error?.details ?? {},
    );
  }
  await storePost("/api/v1/files/complete", { mediaAssetId: started.mediaAssetId });
  return started.mediaAssetId;
}
