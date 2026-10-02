import type { Prisma, PrismaClient, SupplierStatus } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { runInTransaction, type Db } from "@/server/db/transaction";
import { AppError } from "@/server/errors/app-error";
import type { Pagination } from "@/server/http/response";
import type { Logger } from "@/server/logging/logger";
import { AUDIT_ENTITY_TYPES, employeeActor, recordAudit } from "@/server/modules/audit/audit";
import { conflict } from "@/server/modules/catalog/errors";
import type {
  CreateSupplierInput,
  ListSuppliersQuery,
  UpdateSupplierInput,
} from "@/server/modules/suppliers/schemas";
import { systemClock, type Clock } from "@/server/time/time";

/**
 * Suppliers (TASK-021, DB design §11, API §21, Business Spec Q112, ADR-0026).
 *
 * - A supplier's contact details are its phone, email and address.
 * - Nothing is hard-deleted (a trigger rejects DELETE): a supplier is
 *   deactivated, which stops new purchase orders (TASK-022) while its
 *   purchases, invoices and ledger keep pointing at it.
 * - Names are unique, ignoring case.
 * - Every change writes an audit entry in its transaction.
 */

export interface SupplierActor {
  employeeId: string;
}

export interface SupplierView {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  status: SupplierStatus;
  createdAt: string;
  updatedAt: string;
}

type SupplierRow = Prisma.SupplierGetPayload<object>;

const FIELDS = ["name", "phone", "email", "address", "notes", "status"] as const;

function supplierNotFound(): AppError {
  return new AppError("NOT_FOUND", "Supplier not found.");
}

function snapshot(row: SupplierRow) {
  return Object.fromEntries(FIELDS.map((key) => [key, row[key]]));
}

function toView(row: SupplierRow): SupplierView {
  return {
    ...(snapshot(row) as Omit<SupplierView, "id" | "createdAt" | "updatedAt">),
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Refuses a name another supplier already uses (any case).
 * ponytail: app-level check, a race between two creates can slip through;
 * add a unique index on lower(name) if that ever matters.
 */
async function assertNameFree(tx: Db, name: string, exceptId?: string): Promise<void> {
  const clash = await tx.supplier.findFirst({
    where: {
      name: { equals: name, mode: "insensitive" },
      ...(exceptId ? { NOT: { id: exceptId } } : {}),
    },
    select: { id: true },
  });
  if (clash) {
    throw conflict("Another supplier already uses this name.", { reason: "NAME_TAKEN" });
  }
}

export function createSuppliersService(deps: { db: PrismaClient; clock: Clock }) {
  const { db, clock } = deps;

  async function createSupplier(
    actor: SupplierActor,
    input: CreateSupplierInput,
    logger: Logger,
    correlationId: string | null = null,
  ): Promise<SupplierView> {
    const now = clock.now();
    const supplier = await runInTransaction(
      async (tx) => {
        await assertNameFree(tx, input.name);
        const created = await tx.supplier.create({
          data: {
            name: input.name,
            phone: input.phone ?? null,
            email: input.email ?? null,
            address: input.address ?? null,
            notes: input.notes ?? null,
            status: "ACTIVE",
            createdAt: now,
            updatedAt: now,
          },
        });
        await recordAudit(tx, {
          actor: employeeActor(actor.employeeId),
          action: "SUPPLIER_CREATED",
          entityType: AUDIT_ENTITY_TYPES.supplier,
          entityId: created.id,
          next: snapshot(created),
          correlationId,
          createdAt: now,
        });
        return toView(created);
      },
      {},
      db,
    );
    logger.info("supplier created", { supplierId: supplier.id, actorEmployeeId: actor.employeeId });
    return supplier;
  }

  async function listSuppliers(
    query: ListSuppliersQuery,
  ): Promise<{ items: SupplierView[]; pagination: Pagination }> {
    const search = query.search;
    const where: Prisma.SupplierWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { phone: { contains: search } },
              { email: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      db.supplier.count({ where }),
      db.supplier.findMany({
        where,
        orderBy: [{ name: "asc" }, { id: "asc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      items: rows.map(toView),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    };
  }

  async function updateSupplier(
    actor: SupplierActor,
    supplierId: string,
    input: UpdateSupplierInput,
    logger: Logger,
    correlationId: string | null = null,
  ): Promise<SupplierView> {
    const now = clock.now();
    const { view, changed } = await runInTransaction(
      async (tx) => {
        // Row lock: a purchase order created for this supplier at the same
        // moment (TASK-022) sees either the old or the new status.
        const locked = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM suppliers WHERE id = ${supplierId}::uuid FOR UPDATE`;
        if (locked.length === 0) {
          throw supplierNotFound();
        }
        const existing = await tx.supplier.findUniqueOrThrow({ where: { id: supplierId } });
        const data: Prisma.SupplierUpdateInput = {};
        for (const key of FIELDS) {
          if (input[key] !== undefined && input[key] !== existing[key]) {
            Object.assign(data, { [key]: input[key] });
          }
        }
        if (Object.keys(data).length === 0) {
          return { view: toView(existing), changed: false };
        }
        if (typeof data.name === "string") {
          await assertNameFree(tx, data.name, supplierId);
        }
        const updated = await tx.supplier.update({
          where: { id: supplierId },
          data: { ...data, updatedAt: now },
        });
        await recordAudit(tx, {
          actor: employeeActor(actor.employeeId),
          action: "SUPPLIER_UPDATED",
          entityType: AUDIT_ENTITY_TYPES.supplier,
          entityId: supplierId,
          previous: snapshot(existing),
          next: snapshot(updated),
          correlationId,
          createdAt: now,
        });
        return { view: toView(updated), changed: true };
      },
      {},
      db,
    );
    if (changed) {
      logger.info("supplier updated", { supplierId, actorEmployeeId: actor.employeeId });
    }
    return view;
  }

  return { createSupplier, listSuppliers, updateSupplier };
}

export type SuppliersService = ReturnType<typeof createSuppliersService>;

let defaultService: SuppliersService | undefined;

export function getSuppliersService(): SuppliersService {
  defaultService ??= createSuppliersService({ db: getDb(), clock: systemClock });
  return defaultService;
}
