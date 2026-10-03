import { z } from "zod";
import { pageQuery, uuidParam } from "@/server/modules/rbac/schemas";

/** Request schemas of the admin purchase order endpoints (TASK-022, API §21, ADR-0027). */

export const PURCHASE_ITEMS_MAX = 200;

const notes = z.string().trim().min(1).max(2000);
const reason = z.string().trim().min(1).max(1000);

const item = z.object({
  variantId: uuidParam,
  quantity: z.int().min(1).max(100_000),
  /**
   * Piastres per unit. With the quantity and line limits a total stays far
   * below 2^53, so it is exact in JSON.
   */
  unitCost: z
    .int()
    .min(1)
    .max(100_000_000)
    .transform((value) => BigInt(value)),
});

const items = z
  .array(item)
  .min(1)
  .max(PURCHASE_ITEMS_MAX)
  .refine((lines) => new Set(lines.map((line) => line.variantId)).size === lines.length, {
    message: "Each variant may appear only once.",
  });

export const purchaseStatusSchema = z.enum([
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "SENT",
  "PARTIALLY_RECEIVED",
  "RECEIVED",
  "CLOSED",
  "CANCELLED",
]);

export const createPurchaseSchema = z.object({
  supplierId: uuidParam,
  notes: notes.nullable().optional(),
  items,
});

export const updatePurchaseSchema = z
  .object({
    supplierId: uuidParam.optional(),
    /** `null` clears the notes. */
    notes: notes.nullable().optional(),
    /** Replaces every line. */
    items: items.optional(),
  })
  .refine((value) => Object.values(value).some((v) => v !== undefined), {
    message: "Provide at least one field to change.",
  });

export const optionalReasonSchema = z.object({ reason: reason.optional() });
export const requiredReasonSchema = z.object({ reason });

export const listPurchasesQuerySchema = z.object({
  ...pageQuery,
  status: purchaseStatusSchema.optional(),
  supplierId: uuidParam.optional(),
  /** Matches the purchase number. */
  search: z.string().trim().min(1).max(50).optional(),
});

/** `POST /admin/purchases/{id}/receive` (TASK-023, ADR-0028): one delivery, line by line. */
export const receivePurchaseSchema = z.object({
  notes: notes.nullable().optional(),
  items: z
    .array(
      z.object({
        purchaseItemId: uuidParam,
        /** Units counted in this delivery for the line. */
        deliveredQuantity: z.int().min(1).max(100_000),
        /** Of those, units found damaged on inspection. */
        damagedQuantity: z.int().min(0).max(100_000).default(0),
        /** Required when the line differs from what was due (User Flows §14.1). */
        notes: z.string().trim().min(1).max(1000).optional(),
      }),
    )
    .min(1)
    .max(PURCHASE_ITEMS_MAX)
    .refine((lines) => new Set(lines.map((line) => line.purchaseItemId)).size === lines.length, {
      message: "Each purchase line may appear only once.",
    }),
});

/** Piastres; far below 2^53. */
const invoiceAmount = (min: number) =>
  z
    .int()
    .min(min)
    .max(1_000_000_000_000)
    .transform((value) => BigInt(value));

/** `POST /admin/purchases/{id}/invoice` (Q115, Q117): the invoice as issued. */
export const recordInvoiceSchema = z
  .object({
    invoiceNumber: z.string().trim().min(1).max(100),
    invoiceDate: z.iso.date({ message: "Use a date such as 2026-10-03." }),
    invoiceTotal: invoiceAmount(1),
    taxAmount: invoiceAmount(0).nullable().optional(),
    /** A completed upload of purpose SUPPLIER_INVOICE. */
    mediaAssetId: uuidParam,
    notes: notes.nullable().optional(),
  })
  .refine((value) => value.taxAmount == null || value.taxAmount <= value.invoiceTotal, {
    path: ["taxAmount"],
    message: "The tax cannot be more than the invoice total.",
  });

/** `POST /admin/purchases/{id}/supplier-return` (TASK-024, Q105, ADR-0029): damaged units going back. */
export const createSupplierReturnSchema = z.object({
  reason,
  items: z
    .array(
      z.object({
        /** The goods receipt line whose damaged units go back. */
        goodsReceiptItemId: uuidParam,
        quantity: z.int().min(1).max(100_000),
        reason: reason.optional(),
      }),
    )
    .min(1)
    .max(PURCHASE_ITEMS_MAX)
    .refine(
      (lines) => new Set(lines.map((line) => line.goodsReceiptItemId)).size === lines.length,
      { message: "Each goods receipt line may appear only once." },
    ),
});

export const supplierReturnStatusSchema = z.enum([
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "REJECTED",
  "SETTLED",
]);

export const listSupplierReturnsQuerySchema = z.object({
  ...pageQuery,
  status: supplierReturnStatusSchema.optional(),
  supplierId: uuidParam.optional(),
  purchaseId: uuidParam.optional(),
});

/** `POST /admin/supplier-returns/{id}/settle` (Q107, Q120). */
export const settleSupplierReturnSchema = z.object({
  resolution: z.enum(["REFUND", "CREDIT", "OTHER"]),
  /** Piastres; defaults to the expected amount. Not allowed for OTHER. */
  amount: invoiceAmount(1).optional(),
  /** Required for OTHER and when the amount differs from the expected one. */
  notes: notes.optional(),
});

/** `POST /admin/suppliers/{id}/payments` (API v1.1 "Supplier finance"). */
export const recordSupplierPaymentSchema = z.object({
  amount: invoiceAmount(1),
  method: z.enum(["CASH", "BANK_TRANSFER", "CHEQUE", "OTHER"]),
  paidOn: z.iso.date({ message: "Use a date such as 2026-10-03." }),
  /** The purchase order paid for, when there is one (Q118). */
  purchaseId: uuidParam.optional(),
  reference: z.string().trim().min(1).max(200).optional(),
  notes: notes.optional(),
});

export const supplierLedgerQuerySchema = z.object({ ...pageQuery });

export type CreateSupplierReturnInput = z.infer<typeof createSupplierReturnSchema>;
export type ListSupplierReturnsQuery = z.infer<typeof listSupplierReturnsQuerySchema>;
export type SettleSupplierReturnInput = z.infer<typeof settleSupplierReturnSchema>;
export type RecordSupplierPaymentInput = z.infer<typeof recordSupplierPaymentSchema>;
export type ReceivePurchaseInput = z.infer<typeof receivePurchaseSchema>;
export type RecordInvoiceInput = z.infer<typeof recordInvoiceSchema>;
export type CreatePurchaseInput = z.infer<typeof createPurchaseSchema>;
export type UpdatePurchaseInput = z.infer<typeof updatePurchaseSchema>;
export type PurchaseItemInput = z.infer<typeof item>;
export type ListPurchasesQuery = z.infer<typeof listPurchasesQuerySchema>;
