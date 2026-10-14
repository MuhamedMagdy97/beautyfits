import { z } from "zod";

/**
 * `POST /analytics/events` (TASK-050, API §27). Clients submit only the
 * events the server cannot see itself; Add to Cart and Order Created are
 * recorded by the server (ADR-0044).
 */
export const clientEventSchema = z.discriminatedUnion("eventType", [
  z.object({ eventType: z.literal("PRODUCT_VIEW"), productId: z.uuid() }),
  /** The shopper opened checkout; the server finds their cart. */
  z.object({ eventType: z.literal("CHECKOUT_STARTED") }),
]);

export type ClientEventInput = z.output<typeof clientEventSchema>;

/** Longest custom reporting range in calendar days (a technical bound on query cost). */
export const MAX_REPORT_DAYS = 366;

/**
 * Reporting period of `GET /admin/analytics/*` (TASK-051, Q149) in
 * Africa/Cairo calendar days (R20). `7D`/`30D`/`90D` end today; `CUSTOM`
 * needs `from` and `to` (inclusive).
 */
const rangeFields = {
  range: z.enum(["TODAY", "YESTERDAY", "7D", "30D", "90D", "CUSTOM"]).default("30D"),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
};

function checkCustomRange(
  value: { range: string; from?: string; to?: string },
  ctx: z.core.$RefinementCtx,
) {
  if (value.range !== "CUSTOM") {
    return;
  }
  if (!value.from || !value.to) {
    ctx.addIssue({ code: "custom", path: ["from"], message: "CUSTOM needs from and to" });
    return;
  }
  const days = (Date.parse(value.to) - Date.parse(value.from)) / 86_400_000 + 1;
  if (days < 1 || days > MAX_REPORT_DAYS) {
    ctx.addIssue({
      code: "custom",
      path: ["to"],
      message: `to must be on or after from, at most ${MAX_REPORT_DAYS} days later`,
    });
  }
}

export const reportQuerySchema = z.object(rangeFields).superRefine(checkCustomRange);

export const productReportQuerySchema = z
  .object({
    ...rangeFields,
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(24),
  })
  .superRefine(checkCustomRange);

export type ReportQuery = z.output<typeof reportQuerySchema>;
export type ProductReportQuery = z.output<typeof productReportQuerySchema>;
