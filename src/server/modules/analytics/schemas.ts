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
