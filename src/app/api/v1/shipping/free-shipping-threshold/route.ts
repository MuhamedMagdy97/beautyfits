import { getDb } from "@/server/db/client";
import { ok } from "@/server/http/response";
import { withApi } from "@/server/http/route-handler";
import { toJsonNumber } from "@/server/money/money";
import { readFreeShippingThreshold } from "@/server/modules/settings/settings";

/**
 * GET /api/v1/shipping/free-shipping-threshold — the order total (piastres,
 * after discounts) from which shipping is free (R37), for the storefront
 * announcement bar. Public, read-only; the same setting checkout uses.
 */
export const GET = withApi(async (_request, api) => {
  const threshold = await readFreeShippingThreshold(getDb(), api.logger);
  return ok(api.requestId, { freeShippingThreshold: toJsonNumber(threshold), currency: "EGP" });
});
