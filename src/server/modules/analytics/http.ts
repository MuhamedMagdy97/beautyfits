import { z } from "zod";
import type { Visitor } from "@/server/modules/analytics/analytics-service";
import type { CartOwner } from "@/server/modules/cart/cart-service";

/** Header carrying the client's random anonymous visitor id (API §27, Q146). */
export const ANONYMOUS_ID_HEADER = "x-anonymous-id";

const uuid = z.uuid();

/** The analytics visitor of a request whose cart owner is already resolved. */
export function analyticsVisitor(request: Request, owner: CartOwner): Visitor {
  const parsed = uuid.safeParse(request.headers.get(ANONYMOUS_ID_HEADER));
  return {
    customerId: owner.kind === "customer" ? owner.customerId : null,
    anonymousId: parsed.success ? parsed.data.toLowerCase() : null,
  };
}
