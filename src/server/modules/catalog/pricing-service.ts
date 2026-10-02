import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { runInTransaction, type Db } from "@/server/db/transaction";
import type { Logger } from "@/server/logging/logger";
import { AUDIT_ENTITY_TYPES, employeeActor, recordAudits } from "@/server/modules/audit/audit";
import { conflict, validationError } from "@/server/modules/catalog/errors";
import {
  marginBasisPoints,
  marginWarnings,
  type MarginWarning,
  suggestedPrice,
} from "@/server/modules/catalog/pricing";
import {
  assertProductChangeable,
  assertVariantActive,
  lockProduct,
  lockVariant,
  productNotFound,
} from "@/server/modules/catalog/product-guards";
import {
  type CatalogActor,
  toVariantView,
  type VariantView,
} from "@/server/modules/catalog/products-service";
import { readMinMarginBasisPoints } from "@/server/modules/settings/settings";
import { toJsonNumber } from "@/server/money/money";
import { systemClock, type Clock } from "@/server/time/time";

/**
 * Selling prices and costs (TASK-018, Business Spec Q73, Q74, Q102, Q103,
 * Q111, ADR-0023).
 *
 * - A price review sets each variant's price by hand or from a target margin
 *   over the latest purchase cost. It previews by default; with `apply` the
 *   new prices are saved at once (no approval request, R19) and audited.
 *   The system never changes a price on its own.
 * - Margin information reveals the cost, so it is only computed for callers
 *   who may see costs (`VIEW_COST_PRICE`); target margins need it too.
 * - Costs are typed in by hand only as opening values, before the first goods
 *   receipt (ADR-0023 §4 item 4); afterwards only purchasing changes them.
 */

export interface PriceReviewItemInput {
  variantId: string;
  sellingPrice?: bigint;
  targetMarginBasisPoints?: number;
}

export interface PriceReviewInput {
  items: PriceReviewItemInput[];
  apply: boolean;
  reason?: string | null;
}

export interface PriceReviewItemView {
  variantId: string;
  sku: string;
  currentPrice: number | null;
  proposedPrice: number;
  /** The proposed price differs from the current one. */
  changes: boolean;
  /** Only for callers with `VIEW_COST_PRICE`. */
  latestPurchaseCost?: number | null;
  marginBasisPoints?: number | null;
  warnings?: MarginWarning[];
}

export interface PriceReviewView {
  applied: boolean;
  /** The warning threshold (setting `pricing.min_margin_basis_points`); with cost access only. */
  minimumMarginBasisPoints?: number;
  items: PriceReviewItemView[];
}

export interface VariantCostInput {
  latestPurchaseCost?: bigint;
  weightedAverageCost?: bigint;
  reason: string;
}

export interface PricingServiceDeps {
  db: PrismaClient;
  clock: Clock;
}

type VariantRow = Prisma.ProductVariantGetPayload<object>;

function optionalJsonNumber(amount: bigint | null): number | null {
  return amount === null ? null : toJsonNumber(amount);
}

export function createPricingService(deps: PricingServiceDeps) {
  const { db, clock } = deps;

  /** The variants of `productId` named by the review, in request order. */
  async function loadReviewedVariants(
    tx: Db,
    productId: string,
    items: PriceReviewItemInput[],
  ): Promise<VariantRow[]> {
    const rows = await tx.productVariant.findMany({
      where: { id: { in: items.map((item) => item.variantId) } },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    return items.map((item, index) => {
      const row = byId.get(item.variantId);
      if (!row || row.productId !== productId) {
        throw validationError(
          `items.${index}.variantId`,
          "variant_not_found",
          "The variant does not belong to this product.",
        );
      }
      assertVariantActive(row);
      return row;
    });
  }

  /** The price an item asks for: given by hand, or suggested from its target margin (Q111). */
  function proposedPriceOf(item: PriceReviewItemInput, variant: VariantRow): bigint {
    if (item.sellingPrice !== undefined) {
      return item.sellingPrice;
    }
    const cost = variant.latestPurchaseCost;
    if (cost === null) {
      throw conflict("The variant has no purchase cost to suggest a price from.", {
        reason: "COST_UNKNOWN",
        variantId: variant.id,
      });
    }
    const price = suggestedPrice(cost, item.targetMarginBasisPoints!);
    if (price === null) {
      throw conflict("A zero cost gives no price for a target margin; give the price by hand.", {
        reason: "PRICE_SUGGESTION_UNAVAILABLE",
        variantId: variant.id,
      });
    }
    return price;
  }

  /**
   * `POST /admin/products/{id}/price-review`: previews or applies new selling
   * prices for some of the product's active variants. Variants whose price
   * does not change are left alone and get no audit entry.
   */
  async function reviewPrices(
    actor: CatalogActor,
    productId: string,
    input: PriceReviewInput,
    options: { canViewCost: boolean },
    logger: Logger,
    correlationId: string | null = null,
  ): Promise<PriceReviewView> {
    const now = clock.now();
    const { view, changedCount } = await runInTransaction(
      async (tx) => {
        const product = input.apply
          ? await lockProduct(tx, productId)
          : await tx.product.findUnique({ where: { id: productId } });
        if (!product) {
          throw productNotFound();
        }
        assertProductChangeable(product);
        const variants = await loadReviewedVariants(tx, productId, input.items);
        const minimum = options.canViewCost ? await readMinMarginBasisPoints(tx, logger) : 0;

        const reviewed = input.items.map((item, index) => {
          const variant = variants[index];
          const proposed = proposedPriceOf(item, variant);
          const cost = variant.latestPurchaseCost;
          const itemView: PriceReviewItemView = {
            variantId: variant.id,
            sku: variant.sku,
            currentPrice: optionalJsonNumber(variant.sellingPrice),
            proposedPrice: toJsonNumber(proposed),
            changes: variant.sellingPrice !== proposed,
          };
          if (options.canViewCost) {
            itemView.latestPurchaseCost = optionalJsonNumber(cost);
            itemView.marginBasisPoints = cost === null ? null : marginBasisPoints(proposed, cost);
            itemView.warnings = marginWarnings(proposed, cost, minimum);
          }
          return { item, variant, proposed, itemView };
        });

        const changed = reviewed.filter((entry) => entry.itemView.changes);
        if (input.apply && changed.length > 0) {
          for (const entry of changed) {
            await tx.productVariant.update({
              where: { id: entry.variant.id },
              data: { sellingPrice: entry.proposed, updatedAt: now },
            });
          }
          await recordAudits(
            tx,
            changed.map((entry) => ({
              actor: employeeActor(actor.employeeId),
              action: "PRODUCT_VARIANT_PRICE_CHANGED" as const,
              entityType: AUDIT_ENTITY_TYPES.productVariant,
              entityId: entry.variant.id,
              previous: { sellingPrice: entry.itemView.currentPrice },
              next: {
                sellingPrice: entry.itemView.proposedPrice,
                ...(entry.item.targetMarginBasisPoints !== undefined
                  ? { targetMarginBasisPoints: entry.item.targetMarginBasisPoints }
                  : {}),
              },
              reason: input.reason ?? null,
              correlationId,
              createdAt: now,
            })),
          );
        }
        return {
          view: {
            applied: input.apply,
            ...(options.canViewCost ? { minimumMarginBasisPoints: minimum } : {}),
            items: reviewed.map((entry) => entry.itemView),
          },
          changedCount: input.apply ? changed.length : 0,
        };
      },
      {},
      db,
    );
    if (changedCount > 0) {
      logger.info("variant prices changed", {
        productId,
        variantCount: changedCount,
        actorEmployeeId: actor.employeeId,
      });
    }
    return view;
  }

  /**
   * `PATCH /admin/variants/{id}/cost`: opening costs typed in by hand, only
   * until the first goods receipt sets them (ADR-0023 §4 item 4).
   */
  async function updateVariantCosts(
    actor: CatalogActor,
    variantId: string,
    input: VariantCostInput,
    logger: Logger,
    correlationId: string | null = null,
  ): Promise<VariantView> {
    const now = clock.now();
    const { view, changed } = await runInTransaction(
      async (tx) => {
        const { product, variant } = await lockVariant(tx, variantId);
        assertProductChangeable(product);
        assertVariantActive(variant);
        if (variant.firstGoodsReceiptAt !== null) {
          throw conflict(
            "Costs come from goods receipts once the variant has been received; correct them through purchasing.",
            { reason: "COSTS_LOCKED" },
          );
        }
        const data: Prisma.ProductVariantUncheckedUpdateInput = {};
        if (
          input.latestPurchaseCost !== undefined &&
          input.latestPurchaseCost !== variant.latestPurchaseCost
        ) {
          data.latestPurchaseCost = input.latestPurchaseCost;
        }
        if (
          input.weightedAverageCost !== undefined &&
          input.weightedAverageCost !== variant.weightedAverageCost
        ) {
          data.weightedAverageCost = input.weightedAverageCost;
        }
        if (Object.keys(data).length === 0) {
          return { view: toVariantView(variant), changed: false };
        }
        const updated = await tx.productVariant.update({
          where: { id: variantId },
          data: { ...data, updatedAt: now },
        });
        await recordAudits(tx, [
          {
            actor: employeeActor(actor.employeeId),
            action: "PRODUCT_VARIANT_COST_CHANGED",
            entityType: AUDIT_ENTITY_TYPES.productVariant,
            entityId: variantId,
            previous: {
              latestPurchaseCost: optionalJsonNumber(variant.latestPurchaseCost),
              weightedAverageCost: optionalJsonNumber(variant.weightedAverageCost),
            },
            next: {
              latestPurchaseCost: optionalJsonNumber(updated.latestPurchaseCost),
              weightedAverageCost: optionalJsonNumber(updated.weightedAverageCost),
            },
            reason: input.reason,
            correlationId,
            createdAt: now,
          },
        ]);
        return { view: toVariantView(updated), changed: true };
      },
      {},
      db,
    );
    if (changed) {
      // Cost values stay out of the logs; the audit entry has them.
      logger.info("variant costs changed", { variantId, actorEmployeeId: actor.employeeId });
    }
    return view;
  }

  return { reviewPrices, updateVariantCosts };
}

export type PricingService = ReturnType<typeof createPricingService>;

let defaultService: PricingService | undefined;

export function getPricingService(): PricingService {
  defaultService ??= createPricingService({ db: getDb(), clock: systemClock });
  return defaultService;
}
