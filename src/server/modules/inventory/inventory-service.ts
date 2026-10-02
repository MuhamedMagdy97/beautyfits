import type {
  AuditActorType,
  InventoryMovementType,
  Prisma,
  PrismaClient,
} from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { runInTransaction, type Db } from "@/server/db/transaction";
import type { Pagination } from "@/server/http/response";
import type { Logger } from "@/server/logging/logger";
import { AUDIT_ENTITY_TYPES, employeeActor, recordAudit } from "@/server/modules/audit/audit";
import { conflict } from "@/server/modules/catalog/errors";
import { variantNotFound } from "@/server/modules/catalog/product-guards";
import {
  adjustmentDeltas,
  applyDeltas,
  effectiveThreshold,
  isLowStock,
  type ManualMovementType,
  type Quantities,
} from "@/server/modules/inventory/inventory";
import { systemClock, type Clock } from "@/server/time/time";

/**
 * Inventory balances and the movement ledger (TASK-019, API §22, Business
 * Spec Q71, Q72, Q108, Q109, ADR-0024).
 *
 * Every variant has one balance row (created with it by a trigger). Stock
 * changes only by inserting an inventory movement: a database trigger applies
 * its deltas to the balance and the balance's check keeps every quantity at
 * zero or above. Services lock the balance row first so they can refuse a
 * change with a clear error instead of hitting the check.
 */

export interface InventoryActor {
  employeeId: string;
}

export interface InventoryItemView {
  variantId: string;
  sku: string;
  variantNameAr: string | null;
  variantNameEn: string | null;
  variantStatus: "ACTIVE" | "ARCHIVED";
  product: { id: string; nameAr: string; nameEn: string; status: string };
  /** Sellable. */
  availableQuantity: number;
  /** Held for orders; not sellable. */
  reservedQuantity: number;
  /** Damaged / non-sellable. */
  damagedQuantity: number;
  /** The variant's threshold, else the product's; null: no alert (ADR-0024). */
  lowStockThreshold: number | null;
  lowStock: boolean;
  updatedAt: string;
}

export interface InventoryMovementView {
  id: string;
  variantId: string;
  type: InventoryMovementType;
  availableDelta: number;
  reservedDelta: number;
  damagedDelta: number;
  referenceType: string | null;
  referenceId: string | null;
  // unit_cost is not returned: it is cost data (VIEW_COST_PRICE) and only
  // goods receipts set it (TASK-023).
  reason: string | null;
  createdBy: { type: AuditActorType; id: string | null };
  createdAt: string;
}

export interface AdjustInventoryInput {
  type: ManualMovementType;
  quantity: number;
  reason: string;
}

export interface InventoryServiceDeps {
  db: PrismaClient;
  clock: Clock;
}

const itemInclude = {
  product: true,
  inventoryBalance: true,
} satisfies Prisma.ProductVariantInclude;

type ItemRow = Prisma.ProductVariantGetPayload<{ include: typeof itemInclude }>;
type MovementRow = Prisma.InventoryMovementGetPayload<object>;

function quantitiesOf(row: ItemRow): Quantities {
  const balance = row.inventoryBalance;
  return {
    available: balance?.availableQuantity ?? 0,
    reserved: balance?.reservedQuantity ?? 0,
    damaged: balance?.damagedQuantity ?? 0,
  };
}

function toItemView(row: ItemRow): InventoryItemView {
  const quantities = quantitiesOf(row);
  const threshold = effectiveThreshold(row.lowStockThreshold, row.product.lowStockThreshold);
  const onSale = row.status === "ACTIVE" && row.product.status !== "ARCHIVED";
  return {
    variantId: row.id,
    sku: row.sku,
    variantNameAr: row.variantNameAr,
    variantNameEn: row.variantNameEn,
    variantStatus: row.status,
    product: {
      id: row.product.id,
      nameAr: row.product.nameAr,
      nameEn: row.product.nameEn,
      status: row.product.status,
    },
    availableQuantity: quantities.available,
    reservedQuantity: quantities.reserved,
    damagedQuantity: quantities.damaged,
    lowStockThreshold: threshold,
    lowStock: isLowStock(quantities.available, threshold, onSale),
    updatedAt: (row.inventoryBalance?.updatedAt ?? row.createdAt).toISOString(),
  };
}

function toMovementView(row: MovementRow): InventoryMovementView {
  return {
    id: row.id,
    variantId: row.productVariantId,
    type: row.movementType,
    availableDelta: row.availableDelta,
    reservedDelta: row.reservedDelta,
    damagedDelta: row.damagedDelta,
    referenceType: row.referenceType,
    referenceId: row.referenceId,
    reason: row.reason,
    createdBy: { type: row.createdByType, id: row.createdById },
    createdAt: row.createdAt.toISOString(),
  };
}

function pagination(page: number, pageSize: number, total: number): Pagination {
  return { page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
}

const QUANTITY_NAMES = {
  available: "Available",
  reserved: "Reserved",
  damaged: "Damaged",
} as const;

async function loadItem(db: Db, variantId: string): Promise<InventoryItemView> {
  const row = await db.productVariant.findUnique({
    where: { id: variantId },
    include: itemInclude,
  });
  if (!row) {
    throw variantNotFound();
  }
  return toItemView(row);
}

export function createInventoryService(deps: InventoryServiceDeps) {
  const { db, clock } = deps;

  /** `GET /admin/inventory`: every variant's stock, archived ones included, by SKU. */
  async function listInventory(query: {
    page: number;
    pageSize: number;
    search?: string;
  }): Promise<{ items: InventoryItemView[]; pagination: Pagination }> {
    const search = query.search;
    const where: Prisma.ProductVariantWhereInput = search
      ? {
          OR: [
            { sku: { contains: search.toUpperCase() } },
            { product: { nameAr: { contains: search, mode: "insensitive" } } },
            { product: { nameEn: { contains: search, mode: "insensitive" } } },
          ],
        }
      : {};
    const [total, rows] = await Promise.all([
      db.productVariant.count({ where }),
      db.productVariant.findMany({
        where,
        include: itemInclude,
        orderBy: [{ sku: "asc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      items: rows.map(toItemView),
      pagination: pagination(query.page, query.pageSize, total),
    };
  }

  /**
   * `GET /admin/inventory/low-stock` (Q21, Q110): active variants of
   * non-archived products whose Available is at or below their threshold,
   * lowest stock first.
   */
  async function listLowStock(query: {
    page: number;
    pageSize: number;
  }): Promise<{ items: InventoryItemView[]; pagination: Pagination }> {
    const [counted, ids] = await Promise.all([
      db.$queryRaw<{ total: bigint }[]>`
        SELECT count(*) AS total
        FROM product_variants v
        JOIN products p ON p.id = v.product_id
        JOIN inventory_balances b ON b.product_variant_id = v.id
        WHERE v.status = 'ACTIVE' AND p.status <> 'ARCHIVED'
          AND b.available_quantity <= COALESCE(v.low_stock_threshold, p.low_stock_threshold)`,
      db.$queryRaw<{ id: string }[]>`
        SELECT v.id
        FROM product_variants v
        JOIN products p ON p.id = v.product_id
        JOIN inventory_balances b ON b.product_variant_id = v.id
        WHERE v.status = 'ACTIVE' AND p.status <> 'ARCHIVED'
          AND b.available_quantity <= COALESCE(v.low_stock_threshold, p.low_stock_threshold)
        ORDER BY b.available_quantity ASC, v.sku ASC
        LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`,
    ]);
    const rows = await db.productVariant.findMany({
      where: { id: { in: ids.map((row) => row.id) } },
      include: itemInclude,
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    return {
      items: ids.flatMap(({ id }) => {
        const row = byId.get(id);
        return row ? [toItemView(row)] : [];
      }),
      pagination: pagination(query.page, query.pageSize, Number(counted[0]?.total ?? 0)),
    };
  }

  /** `GET /admin/inventory/{variantId}`. */
  async function getInventory(variantId: string): Promise<InventoryItemView> {
    return loadItem(db, variantId);
  }

  /** `GET /admin/inventory/{variantId}/movements`: the variant's ledger, newest first. */
  async function listMovements(
    variantId: string,
    query: { page: number; pageSize: number },
  ): Promise<{ items: InventoryMovementView[]; pagination: Pagination }> {
    const variant = await db.productVariant.findUnique({
      where: { id: variantId },
      select: { id: true },
    });
    if (!variant) {
      throw variantNotFound();
    }
    const where = { productVariantId: variantId };
    const [total, rows] = await Promise.all([
      db.inventoryMovement.count({ where }),
      db.inventoryMovement.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      items: rows.map(toMovementView),
      pagination: pagination(query.page, query.pageSize, total),
    };
  }

  /**
   * `POST /admin/inventory/{variantId}/adjust` (Q71, Q72): applies directly
   * (no approval, ADR-0024), writes one movement with the reason and one
   * audit entry. Archived variants and products may still be adjusted: the
   * stock is physical and must be countable and writable off.
   */
  async function adjust(
    actor: InventoryActor,
    variantId: string,
    input: AdjustInventoryInput,
    logger: Logger,
    correlationId: string | null = null,
  ): Promise<{ inventory: InventoryItemView; movement: InventoryMovementView }> {
    const now = clock.now();
    const deltas = adjustmentDeltas(input.type, input.quantity);
    const result = await runInTransaction(
      async (tx) => {
        const locked = await tx.$queryRaw<
          { available: number; reserved: number; damaged: number }[]
        >`
          SELECT available_quantity AS available, reserved_quantity AS reserved,
                 damaged_quantity AS damaged
          FROM inventory_balances
          WHERE product_variant_id = ${variantId}::uuid
          FOR UPDATE`;
        const current = locked[0];
        if (!current) {
          throw variantNotFound();
        }
        const outcome = applyDeltas(current, deltas);
        if (!outcome.ok) {
          throw conflict(`Not enough ${QUANTITY_NAMES[outcome.short]} stock for this adjustment.`, {
            reason: "INSUFFICIENT_STOCK",
            quantity: outcome.short,
            onHand: current[outcome.short],
          });
        }
        const movement = await tx.inventoryMovement.create({
          data: {
            productVariantId: variantId,
            movementType: input.type,
            ...deltas,
            reason: input.reason,
            createdByType: "EMPLOYEE",
            createdById: actor.employeeId,
            createdAt: now,
          },
        });
        await recordAudit(tx, {
          actor: employeeActor(actor.employeeId),
          action: "INVENTORY_ADJUSTED",
          entityType: AUDIT_ENTITY_TYPES.productVariant,
          entityId: variantId,
          previous: { ...current },
          next: {
            ...outcome.next,
            movementId: movement.id,
            movementType: input.type,
            quantity: input.quantity,
          },
          reason: input.reason,
          correlationId,
          createdAt: now,
        });
        return {
          inventory: await loadItem(tx, variantId),
          movement: toMovementView(movement),
        };
      },
      {},
      db,
    );
    logger.info("inventory adjusted", {
      variantId,
      movementId: result.movement.id,
      movementType: input.type,
      actorEmployeeId: actor.employeeId,
    });
    return result;
  }

  return { listInventory, listLowStock, getInventory, listMovements, adjust };
}

export type InventoryService = ReturnType<typeof createInventoryService>;

let defaultService: InventoryService | undefined;

export function getInventoryService(): InventoryService {
  defaultService ??= createInventoryService({ db: getDb(), clock: systemClock });
  return defaultService;
}
