import type { AuditActorType, Prisma, PrismaClient } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import type { Db } from "@/server/db/transaction";
import type { Pagination } from "@/server/http/response";

/**
 * Audit logs (TASK-013, Q70, Q79, Architecture §19, DB design §20, ADR-0018).
 *
 * An audit entry is written in the same transaction as the change it
 * describes, so a change never commits without its entry and a rolled-back
 * change leaves none. Rows are append-only: the database rejects every
 * UPDATE and DELETE.
 *
 * Snapshots (`previous` / `next`) hold only what a reviewer needs to see
 * what changed: never passwords, password hashes, codes or tokens.
 */

/** Stable action codes. Clients may filter on them; add, never rename. */
export const AUDIT_ACTIONS = [
  // Bootstrap (TASK-004)
  "OWNER_BOOTSTRAPPED",
  "ROLE_SEEDED",
  // Roles and staff (TASK-012)
  "ROLE_CREATED",
  "ROLE_UPDATED",
  "EMPLOYEE_INVITED",
  "EMPLOYEE_INVITATION_REVOKED",
  "EMPLOYEE_INVITATION_ACCEPTED",
  "EMPLOYEE_UPDATED",
  "EMPLOYEE_DEACTIVATED",
  // Approval requests (TASK-013)
  "APPROVAL_REQUESTED",
  "APPROVAL_APPROVED",
  "APPROVAL_REJECTED",
  "APPROVAL_CANCELLED",
  // Products and variants (TASK-014)
  "PRODUCT_CREATED",
  "PRODUCT_UPDATED",
  "PRODUCT_VARIANT_CREATED",
  "PRODUCT_VARIANT_UPDATED",
  "PRODUCT_VARIANT_ARCHIVED",
  // Brands and categories (TASK-015)
  "BRAND_CREATED",
  "BRAND_UPDATED",
  "CATEGORY_CREATED",
  "CATEGORY_UPDATED",
  // Product media (TASK-016)
  "PRODUCT_MEDIA_ADDED",
  "PRODUCT_MEDIA_UPDATED",
  "PRODUCT_MEDIA_REMOVED",
  "PRODUCT_MEDIA_REORDERED",
  // Product lifecycle (TASK-017)
  "PRODUCT_PUBLISHED",
  "PRODUCT_UNPUBLISHED",
  "PRODUCT_DISABLED",
  "PRODUCT_ARCHIVED",
  // Prices and costs (TASK-018)
  "PRODUCT_VARIANT_PRICE_CHANGED",
  "PRODUCT_VARIANT_COST_CHANGED",
  // Inventory (TASK-019)
  "INVENTORY_ADJUSTED",
  // Suppliers (TASK-021)
  "SUPPLIER_CREATED",
  "SUPPLIER_UPDATED",
  // Purchase orders (TASK-022)
  "PURCHASE_ORDER_CREATED",
  "PURCHASE_ORDER_UPDATED",
  "PURCHASE_ORDER_SUBMITTED",
  "PURCHASE_ORDER_APPROVED",
  "PURCHASE_ORDER_REJECTED",
  "PURCHASE_ORDER_SENT",
  "PURCHASE_ORDER_CANCELLED",
  // Goods receiving and supplier invoices (TASK-023)
  "GOODS_RECEIPT_RECORDED",
  "PURCHASE_OVER_DELIVERY_ACCEPTED",
  "PURCHASE_OVER_DELIVERY_REJECTED",
  "PURCHASE_INVOICE_RECORDED",
  "PURCHASE_ORDER_CLOSED",
  // Supplier returns, payments and ledger (TASK-024)
  "SUPPLIER_RETURN_CREATED",
  "SUPPLIER_RETURN_SUBMITTED",
  "SUPPLIER_RETURN_APPROVED",
  "SUPPLIER_RETURN_REJECTED",
  "SUPPLIER_RETURN_SETTLED",
  "SUPPLIER_PAYMENT_RECORDED",
  // Customer profile and locations (TASK-009)
  "CUSTOMER_EMAIL_CHANGED",
  "CUSTOMER_PHONE_CHANGED",
  "CUSTOMER_DEACTIVATED",
  "GOVERNORATE_UPDATED",
  "AREA_CREATED",
  "AREA_UPDATED",
  // Discounts (TASK-026)
  "DISCOUNT_CREATED",
  "DISCOUNT_UPDATED",
  "DISCOUNT_ACTIVATED",
  "DISCOUNT_DEACTIVATED",
  // Shipping (TASK-027)
  "SHIPPING_COMPANY_CREATED",
  "SHIPPING_COMPANY_UPDATED",
  "SHIPPING_RULE_CREATED",
  "SHIPPING_RULE_UPDATED",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** Entity type names used in audit entries and approval requests. */
export const AUDIT_ENTITY_TYPES = {
  role: "ROLE",
  employee: "EMPLOYEE",
  employeeInvitation: "EMPLOYEE_INVITATION",
  approvalRequest: "APPROVAL_REQUEST",
  product: "PRODUCT",
  productVariant: "PRODUCT_VARIANT",
  brand: "BRAND",
  category: "CATEGORY",
  productMedia: "PRODUCT_MEDIA",
  supplier: "SUPPLIER",
  purchaseOrder: "PURCHASE_ORDER",
  goodsReceipt: "GOODS_RECEIPT",
  supplierReturn: "SUPPLIER_RETURN",
  customer: "CUSTOMER",
  governorate: "GOVERNORATE",
  area: "AREA",
  discount: "DISCOUNT",
  shippingCompany: "SHIPPING_COMPANY",
  shippingRule: "SHIPPING_RULE",
} as const;

export interface AuditActor {
  type: AuditActorType;
  /** Employee id or customer id; omitted for SYSTEM. */
  id?: string | null;
}

export const SYSTEM_ACTOR: AuditActor = { type: "SYSTEM", id: null };

export function employeeActor(employeeId: string): AuditActor {
  return { type: "EMPLOYEE", id: employeeId };
}

export interface AuditEntry {
  actor: AuditActor;
  action: AuditAction;
  entityType: string;
  entityId: string;
  previous?: Prisma.InputJsonValue | null;
  next?: Prisma.InputJsonValue | null;
  reason?: string | null;
  /** The API request id, when the change came from a request. */
  correlationId?: string | null;
  createdAt: Date;
}

/** Writes one audit entry. Call it with the transaction that makes the change. */
export async function recordAudit(tx: Db, entry: AuditEntry): Promise<void> {
  await recordAudits(tx, [entry]);
}

export async function recordAudits(tx: Db, entries: readonly AuditEntry[]): Promise<void> {
  if (entries.length === 0) {
    return;
  }
  await tx.auditLog.createMany({
    data: entries.map((entry) => ({
      actorType: entry.actor.type,
      actorId: entry.actor.type === "SYSTEM" ? null : (entry.actor.id ?? null),
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      previousDataJson: entry.previous ?? undefined,
      newDataJson: entry.next ?? undefined,
      reason: entry.reason ?? null,
      correlationId: entry.correlationId ?? null,
      createdAt: entry.createdAt,
    })),
  });
}

export interface AuditLogView {
  id: string;
  actor: {
    type: AuditActorType;
    id: string | null;
    /** The employee's display name when the actor is an employee. */
    displayName: string | null;
  };
  action: string;
  entityType: string;
  entityId: string;
  previousData: unknown;
  newData: unknown;
  reason: string | null;
  correlationId: string | null;
  createdAt: string;
}

export interface AuditLogQuery {
  page: number;
  pageSize: number;
  actorType?: AuditActorType;
  actorId?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  /** Inclusive lower bound. */
  from?: Date;
  /** Exclusive upper bound. */
  to?: Date;
}

export function createAuditLogService(deps: { db: PrismaClient }) {
  const { db } = deps;

  /** Audit log search (`GET /admin/audit-logs`), newest first. */
  async function listAuditLogs(
    query: AuditLogQuery,
  ): Promise<{ items: AuditLogView[]; pagination: Pagination }> {
    const where: Prisma.AuditLogWhereInput = {
      ...(query.actorType ? { actorType: query.actorType } : {}),
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lt: query.to } : {}),
            },
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      db.auditLog.count({ where }),
      db.auditLog.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    const employeeIds = [
      ...new Set(
        rows
          .filter((row) => row.actorType === "EMPLOYEE" && row.actorId)
          .map((row) => row.actorId as string),
      ),
    ];
    const names =
      employeeIds.length === 0
        ? new Map<string, string>()
        : new Map(
            (
              await db.employee.findMany({
                where: { id: { in: employeeIds } },
                select: { id: true, displayName: true },
              })
            ).map((employee) => [employee.id, employee.displayName]),
          );

    return {
      items: rows.map((row) => ({
        id: row.id,
        actor: {
          type: row.actorType,
          id: row.actorId,
          displayName: row.actorId ? (names.get(row.actorId) ?? null) : null,
        },
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        previousData: row.previousDataJson,
        newData: row.newDataJson,
        reason: row.reason,
        correlationId: row.correlationId,
        createdAt: row.createdAt.toISOString(),
      })),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    };
  }

  return { listAuditLogs };
}

export type AuditLogService = ReturnType<typeof createAuditLogService>;

let defaultService: AuditLogService | undefined;

export function getAuditLogService(): AuditLogService {
  defaultService ??= createAuditLogService({ db: getDb() });
  return defaultService;
}
