import { z } from "zod";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import type { Db } from "@/server/db/transaction";
import { REVENUE_ORDER_STATUSES } from "@/server/modules/analytics/reporting-service";
import { withSubcategories } from "@/server/modules/discounts/engine";
import { addMilliseconds, MS_PER_DAY, systemClock, type Clock } from "@/server/time/time";

/**
 * Customer segments (TASK-047, Business Spec Q140, Q141; User Flows §16.2;
 * ADR-0057).
 *
 * - A segment is a definition evaluated on read; nothing is stored. Campaigns
 *   (TASK-048) keep the definition and resolve recipients with
 *   `segmentCustomerIds`.
 * - Every segment is limited to customers currently opted in to the
 *   requested channel in the consent ledger (Q140, ADR-0051): the latest row
 *   per customer and channel is `OPTED_IN`. Nothing is inferred from orders,
 *   an email or a phone (Q59, Q155). Anonymized customers are never included.
 * - Buyer segments count orders in `REVENUE_ORDER_STATUSES`
 *   (TASK-051), so a segment and the analytics revenue agree.
 *   [BUSINESS DECISION REQUIRED] which order statuses make a buyer; see
 *   TASK-047 open items.
 * - Thresholds (inactive days, minimum spend) are chosen per segment by staff
 *   (Q141 "basic/configurable"); the server sets no default.
 */

const ids = z.array(z.uuid()).min(1).max(500);
const channel = z.enum(["EMAIL", "WHATSAPP"]);

export const segmentDefinitionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ALL_OPTED_IN"), channel }),
  z.object({ type: z.literal("PREVIOUS_BUYERS"), channel }),
  z.object({ type: z.literal("PRODUCT_BUYERS"), channel, productIds: ids }),
  z.object({ type: z.literal("BRAND_BUYERS"), channel, brandIds: ids }),
  /** Includes products of the categories' subcategories. */
  z.object({ type: z.literal("CATEGORY_BUYERS"), channel, categoryIds: ids }),
  /** Bought before, but no buying order in the last `inactiveDays` × 24 h. */
  z.object({
    type: z.literal("INACTIVE"),
    channel,
    inactiveDays: z.int().min(1).max(3650),
  }),
  /** Lifetime spend (order line totals after discounts, no shipping) of at least `minSpent` piastres. */
  z.object({
    type: z.literal("HIGH_SPENDING"),
    channel,
    minSpent: z.int().min(1).max(Number.MAX_SAFE_INTEGER),
  }),
]);

export type SegmentDefinition = z.output<typeof segmentDefinitionSchema>;

const buyerStatuses = REVENUE_ORDER_STATUSES as string[];

/** Orders of customer `c` that make them a buyer. */
const buyerOrders = Prisma.sql`SELECT 1 FROM orders o
  WHERE o.customer_id = c.id AND o.status::text = ANY(${buyerStatuses}::text[])`;

async function segmentCondition(db: Db, segment: SegmentDefinition, now: Date) {
  switch (segment.type) {
    case "ALL_OPTED_IN":
      return Prisma.sql`TRUE`;
    case "PREVIOUS_BUYERS":
      return Prisma.sql`EXISTS (${buyerOrders})`;
    case "PRODUCT_BUYERS":
      return Prisma.sql`EXISTS (${buyerOrders} AND EXISTS (SELECT 1 FROM order_items i
        WHERE i.order_id = o.id AND i.product_id = ANY(${segment.productIds}::uuid[])))`;
    case "BRAND_BUYERS":
      return Prisma.sql`EXISTS (${buyerOrders} AND EXISTS (SELECT 1 FROM order_items i
        JOIN products p ON p.id = i.product_id
        WHERE i.order_id = o.id AND p.brand_id = ANY(${segment.brandIds}::uuid[])))`;
    case "CATEGORY_BUYERS": {
      const all = await db.category.findMany({ select: { id: true, parentId: true } });
      const categoryIds = [...withSubcategories(segment.categoryIds, all)];
      return Prisma.sql`EXISTS (${buyerOrders} AND EXISTS (SELECT 1 FROM order_items i
        JOIN product_categories pc ON pc.product_id = i.product_id
        WHERE i.order_id = o.id AND pc.category_id = ANY(${categoryIds}::uuid[])))`;
    }
    case "INACTIVE": {
      const since = addMilliseconds(now, -segment.inactiveDays * MS_PER_DAY);
      return Prisma.sql`EXISTS (${buyerOrders})
        AND NOT EXISTS (${buyerOrders} AND o.created_at >= ${since}::timestamptz)`;
    }
    case "HIGH_SPENDING":
      return Prisma.sql`(SELECT COALESCE(SUM(i.line_total), 0) FROM order_items i
        JOIN orders o ON o.id = i.order_id
        WHERE o.customer_id = c.id AND o.status::text = ANY(${buyerStatuses}::text[]))
        >= ${BigInt(segment.minSpent)}`;
  }
}

/** Ids of the customers in the segment, opted in to its channel now. */
export async function segmentCustomerIds(
  db: Db,
  segment: SegmentDefinition,
  now: Date,
): Promise<string[]> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    WITH consent AS (
      SELECT DISTINCT ON (customer_id) customer_id, status FROM marketing_consents
      WHERE channel = ${segment.channel}::marketing_channel
      ORDER BY customer_id, id DESC
    )
    SELECT c.id::text AS id FROM customers c
    JOIN consent ON consent.customer_id = c.id AND consent.status = 'OPTED_IN'
    WHERE c.anonymized_at IS NULL AND ${await segmentCondition(db, segment, now)}
    ORDER BY c.id`;
  return rows.map((r) => r.id);
}

export function createSegmentService(deps: { db: PrismaClient; clock: Clock }) {
  const { db, clock } = deps;

  /** `POST /admin/segments/preview`: the audience size only, no customer data. */
  async function preview(segment: SegmentDefinition) {
    // ponytail: loads the ids to count them; a COUNT(*) query if audiences reach 100k+.
    const customerIds = await segmentCustomerIds(db, segment, clock.now());
    return { segment, customerCount: customerIds.length };
  }

  return { preview };
}

let defaultService: ReturnType<typeof createSegmentService> | undefined;

export function getSegmentService() {
  defaultService ??= createSegmentService({ db: getDb(), clock: systemClock });
  return defaultService;
}
