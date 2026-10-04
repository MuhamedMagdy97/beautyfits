import type {
  Prisma,
  PrismaClient,
  ShippingCompany,
  ShippingRule,
} from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { runInTransaction, type Db } from "@/server/db/transaction";
import { AppError } from "@/server/errors/app-error";
import type { Pagination } from "@/server/http/response";
import type { Logger } from "@/server/logging/logger";
import { AUDIT_ENTITY_TYPES, employeeActor, recordAudit } from "@/server/modules/audit/audit";
import { conflict, isUniqueViolation, validationError } from "@/server/modules/catalog/errors";
import { findUsableArea } from "@/server/modules/locations/locations-service";
import { readFreeShippingThreshold } from "@/server/modules/settings/settings";
import { quoteShipping, type ShippingQuote } from "@/server/modules/shipping/engine";
import type {
  CreateShippingCompanyInput,
  CreateShippingRuleInput,
  ListShippingCompaniesQuery,
  ListShippingRulesQuery,
  UpdateShippingCompanyInput,
  UpdateShippingRuleInput,
} from "@/server/modules/shipping/schemas";
import { toJsonNumber } from "@/server/money/money";
import { systemClock, type Clock } from "@/server/time/time";

/**
 * Shipping companies, shipping rules and the shipping quote (TASK-027,
 * Business Spec Q121–Q126, R37, API §16, ADR-0033).
 *
 * - Companies and rules are never deleted; `INACTIVE` takes them out of
 *   quotes. Every change writes an audit entry.
 * - The customer pays the fee of the most specific matching rule (engine);
 *   its company is only a proposal that staff may change later (Q126)
 *   without changing the fee. A place without a rule cannot be shipped to.
 * - Free shipping compares the total after discounts with the store-wide
 *   threshold setting `shipping.free_shipping_threshold` (Q123, R37).
 */

export interface ShippingActor {
  employeeId: string;
}

export interface ShippingCompanyView {
  id: string;
  code: string;
  name: string;
  contactInfo: string | null;
  status: "ACTIVE" | "INACTIVE";
  createdAt: string;
  updatedAt: string;
}

export interface ShippingRuleView {
  id: string;
  shippingCompanyId: string | null;
  governorateId: string | null;
  areaId: string | null;
  minOrderTotal: number | null;
  maxOrderTotal: number | null;
  shippingFee: number;
  priority: number;
  activeFrom: string | null;
  activeTo: string | null;
  status: "ACTIVE" | "INACTIVE";
  createdAt: string;
  updatedAt: string;
}

export interface ShippingOptionsView {
  areaId: string;
  /** Piastres, after discounts (the cart `total`). */
  orderTotal: number;
  /** What the customer pays for shipping. */
  shippingFee: number;
  freeShipping: boolean;
  freeShippingThreshold: number;
  /** How much more ships free; 0 once free. */
  amountToFreeShipping: number;
  /** `orderTotal + shippingFee`. */
  total: number;
  currency: "EGP";
}

function money(value: bigint | null): number | null {
  return value === null ? null : toJsonNumber(value);
}

function companySnapshot(row: ShippingCompany) {
  return { code: row.code, name: row.name, contactInfo: row.contactInfo, status: row.status };
}

function companyView(row: ShippingCompany): ShippingCompanyView {
  return {
    id: row.id,
    ...companySnapshot(row),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function ruleSnapshot(row: ShippingRule) {
  return {
    shippingCompanyId: row.shippingCompanyId,
    governorateId: row.governorateId,
    areaId: row.areaId,
    minOrderTotal: money(row.minOrderTotal),
    maxOrderTotal: money(row.maxOrderTotal),
    shippingFee: toJsonNumber(row.shippingFee),
    priority: row.priority,
    activeFrom: row.activeFrom?.toISOString() ?? null,
    activeTo: row.activeTo?.toISOString() ?? null,
    status: row.status,
  };
}

function ruleView(row: ShippingRule): ShippingRuleView {
  return {
    id: row.id,
    ...ruleSnapshot(row),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function shippingUnavailable(areaId: string): AppError {
  return new AppError("SHIPPING_UNAVAILABLE", "We do not ship to this area yet.", {
    details: { areaId },
  });
}

/**
 * The fee for an order to `areaId` (R37), for the quote and for checkout
 * (TASK-029, inside its transaction). The area must be usable (`400`
 * `area_not_found` / `area_inactive`); no matching rule is `422
 * SHIPPING_UNAVAILABLE`.
 */
export async function quoteShippingForArea(
  db: Db,
  input: { areaId: string; orderTotal: bigint; now: Date; logger?: Logger },
): Promise<ShippingQuote & { freeShippingThreshold: bigint }> {
  const area = await findUsableArea(db, input.areaId);
  const [rules, freeShippingThreshold] = await Promise.all([
    db.shippingRule.findMany({
      where: {
        status: "ACTIVE",
        OR: [{ shippingCompanyId: null }, { shippingCompany: { status: "ACTIVE" } }],
        AND: [
          { OR: [{ governorateId: null }, { governorateId: area.governorateId }] },
          { OR: [{ areaId: null }, { areaId: area.id }] },
        ],
      },
    }),
    readFreeShippingThreshold(db, input.logger),
  ]);
  const quote = quoteShipping(rules, {
    governorateId: area.governorateId,
    areaId: area.id,
    orderTotal: input.orderTotal,
    freeShippingThreshold,
    now: input.now,
  });
  if (!quote) {
    throw shippingUnavailable(area.id);
  }
  return { ...quote, freeShippingThreshold };
}

function companyNotFound(): AppError {
  return new AppError("NOT_FOUND", "Shipping company not found.");
}

function ruleNotFound(): AppError {
  return new AppError("NOT_FOUND", "Shipping rule not found.");
}

function codeTaken(error: unknown): AppError | null {
  return isUniqueViolation(error, "code")
    ? conflict("Another shipping company already uses this code.", { reason: "CODE_TAKEN" })
    : null;
}

interface RuleState {
  shippingCompanyId: string | null;
  /** Null with an area: take the area's governorate. */
  governorateId: string | null;
  areaId: string | null;
  minOrderTotal: bigint | null;
  maxOrderTotal: bigint | null;
  activeFrom: Date | null;
  activeTo: Date | null;
}

/** Checks the state after the change; returns it with the area's governorate filled in. */
async function resolveRuleState(tx: Db, state: RuleState): Promise<RuleState> {
  if (state.maxOrderTotal !== null && state.maxOrderTotal <= (state.minOrderTotal ?? BigInt(0))) {
    throw validationError(
      "maxOrderTotal",
      "below_minimum",
      "The maximum must be above the minimum.",
    );
  }
  if (state.activeFrom && state.activeTo && state.activeTo <= state.activeFrom) {
    throw validationError("activeTo", "before_start", "The end must be after the start.");
  }
  if (
    state.shippingCompanyId &&
    !(await tx.shippingCompany.findUnique({ where: { id: state.shippingCompanyId } }))
  ) {
    throw validationError("shippingCompanyId", "not_found", "Unknown shipping company.");
  }
  if (state.areaId) {
    const area = await tx.area.findUnique({ where: { id: state.areaId } });
    if (!area) {
      throw validationError("areaId", "not_found", "Unknown area.");
    }
    if (state.governorateId !== null && state.governorateId !== area.governorateId) {
      throw validationError("areaId", "other_governorate", "The area is not in this governorate.");
    }
    return { ...state, governorateId: area.governorateId };
  }
  if (
    state.governorateId &&
    !(await tx.governorate.findUnique({ where: { id: state.governorateId } }))
  ) {
    throw validationError("governorateId", "not_found", "Unknown governorate.");
  }
  return state;
}

export function createShippingService(deps: { db: PrismaClient; clock: Clock }) {
  const { db, clock } = deps;

  async function listCompanies(query: ListShippingCompaniesQuery): Promise<ShippingCompanyView[]> {
    const rows = await db.shippingCompany.findMany({
      where: query.status ? { status: query.status } : {},
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });
    return rows.map(companyView);
  }

  async function createCompany(
    actor: ShippingActor,
    input: CreateShippingCompanyInput,
    logger: Logger,
    correlationId: string | null = null,
  ): Promise<ShippingCompanyView> {
    const now = clock.now();
    const view = await runInTransaction(
      async (tx) => {
        const row = await tx.shippingCompany
          .create({ data: { ...input, createdAt: now, updatedAt: now } })
          .catch((error: unknown) => {
            throw codeTaken(error) ?? error;
          });
        await recordAudit(tx, {
          actor: employeeActor(actor.employeeId),
          action: "SHIPPING_COMPANY_CREATED",
          entityType: AUDIT_ENTITY_TYPES.shippingCompany,
          entityId: row.id,
          next: companySnapshot(row),
          correlationId,
          createdAt: now,
        });
        return companyView(row);
      },
      {},
      db,
    );
    logger.info("shipping company created", { shippingCompanyId: view.id });
    return view;
  }

  async function updateCompany(
    actor: ShippingActor,
    companyId: string,
    input: UpdateShippingCompanyInput,
    logger: Logger,
    correlationId: string | null = null,
  ): Promise<ShippingCompanyView> {
    const now = clock.now();
    const view = await runInTransaction(
      async (tx) => {
        const locked = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM shipping_companies WHERE id = ${companyId}::uuid FOR UPDATE`;
        if (locked.length === 0) {
          throw companyNotFound();
        }
        const existing = await tx.shippingCompany.findUniqueOrThrow({ where: { id: companyId } });
        const updated = await tx.shippingCompany
          .update({ where: { id: companyId }, data: { ...input, updatedAt: now } })
          .catch((error: unknown) => {
            throw codeTaken(error) ?? error;
          });
        const before = companySnapshot(existing);
        const after = companySnapshot(updated);
        if (JSON.stringify(after) !== JSON.stringify(before)) {
          await recordAudit(tx, {
            actor: employeeActor(actor.employeeId),
            action: "SHIPPING_COMPANY_UPDATED",
            entityType: AUDIT_ENTITY_TYPES.shippingCompany,
            entityId: companyId,
            previous: before,
            next: after,
            correlationId,
            createdAt: now,
          });
        }
        return companyView(updated);
      },
      {},
      db,
    );
    logger.info("shipping company updated", { shippingCompanyId: companyId });
    return view;
  }

  async function listRules(
    query: ListShippingRulesQuery,
  ): Promise<{ items: ShippingRuleView[]; pagination: Pagination }> {
    const where: Prisma.ShippingRuleWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.governorateId ? { governorateId: query.governorateId } : {}),
      ...(query.shippingCompanyId ? { shippingCompanyId: query.shippingCompanyId } : {}),
    };
    const [total, rows] = await Promise.all([
      db.shippingRule.count({ where }),
      db.shippingRule.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      items: rows.map(ruleView),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    };
  }

  async function createRule(
    actor: ShippingActor,
    input: CreateShippingRuleInput,
    logger: Logger,
    correlationId: string | null = null,
  ): Promise<ShippingRuleView> {
    const now = clock.now();
    const view = await runInTransaction(
      async (tx) => {
        const state = await resolveRuleState(tx, input);
        const row = await tx.shippingRule.create({
          data: { ...input, ...state, createdAt: now, updatedAt: now },
        });
        await recordAudit(tx, {
          actor: employeeActor(actor.employeeId),
          action: "SHIPPING_RULE_CREATED",
          entityType: AUDIT_ENTITY_TYPES.shippingRule,
          entityId: row.id,
          next: ruleSnapshot(row),
          correlationId,
          createdAt: now,
        });
        return ruleView(row);
      },
      {},
      db,
    );
    logger.info("shipping rule created", { shippingRuleId: view.id });
    return view;
  }

  async function updateRule(
    actor: ShippingActor,
    ruleId: string,
    input: UpdateShippingRuleInput,
    logger: Logger,
    correlationId: string | null = null,
  ): Promise<ShippingRuleView> {
    const now = clock.now();
    const view = await runInTransaction(
      async (tx) => {
        const locked = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM shipping_rules WHERE id = ${ruleId}::uuid FOR UPDATE`;
        if (locked.length === 0) {
          throw ruleNotFound();
        }
        const existing = await tx.shippingRule.findUniqueOrThrow({ where: { id: ruleId } });
        const pick = <K extends keyof RuleState>(key: K): RuleState[K] =>
          input[key] === undefined ? existing[key] : (input[key] as RuleState[K]);
        const areaId = pick("areaId");
        const state = await resolveRuleState(tx, {
          shippingCompanyId: pick("shippingCompanyId"),
          // A new area without a governorate takes the area's.
          governorateId:
            input.governorateId === undefined && input.areaId && areaId
              ? null
              : pick("governorateId"),
          areaId,
          minOrderTotal: pick("minOrderTotal"),
          maxOrderTotal: pick("maxOrderTotal"),
          activeFrom: pick("activeFrom"),
          activeTo: pick("activeTo"),
        });
        const updated = await tx.shippingRule.update({
          where: { id: ruleId },
          data: { ...input, ...state, updatedAt: now },
        });
        const before = ruleSnapshot(existing);
        const after = ruleSnapshot(updated);
        if (JSON.stringify(after) !== JSON.stringify(before)) {
          await recordAudit(tx, {
            actor: employeeActor(actor.employeeId),
            action: "SHIPPING_RULE_UPDATED",
            entityType: AUDIT_ENTITY_TYPES.shippingRule,
            entityId: ruleId,
            previous: before,
            next: after,
            correlationId,
            createdAt: now,
          });
        }
        return ruleView(updated);
      },
      {},
      db,
    );
    logger.info("shipping rule updated", { shippingRuleId: ruleId });
    return view;
  }

  /** `GET /shipping/options`: the fee for the cart total sent to an area. */
  async function quote(
    areaId: string,
    orderTotal: bigint,
    logger: Logger,
  ): Promise<ShippingOptionsView> {
    const result = await quoteShippingForArea(db, {
      areaId,
      orderTotal,
      now: clock.now(),
      logger,
    });
    const missing = result.freeShippingThreshold - orderTotal;
    return {
      areaId,
      orderTotal: toJsonNumber(orderTotal),
      shippingFee: toJsonNumber(result.shippingFee),
      freeShipping: result.freeShipping,
      freeShippingThreshold: toJsonNumber(result.freeShippingThreshold),
      amountToFreeShipping: toJsonNumber(missing > BigInt(0) ? missing : BigInt(0)),
      total: toJsonNumber(orderTotal + result.shippingFee),
      currency: "EGP",
    };
  }

  return { listCompanies, createCompany, updateCompany, listRules, createRule, updateRule, quote };
}

export type ShippingService = ReturnType<typeof createShippingService>;

let defaultService: ShippingService | undefined;

export function getShippingService(): ShippingService {
  defaultService ??= createShippingService({ db: getDb(), clock: systemClock });
  return defaultService;
}
