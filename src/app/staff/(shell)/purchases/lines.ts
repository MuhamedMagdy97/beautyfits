import type { InventoryItemView } from "@/server/modules/inventory/inventory-service";
import { staffApi } from "../../_lib/api";
import { catalogError } from "../../_lib/catalog-i18n";
import { parsePurchaseLines } from "../../_lib/purchasing";
import { fill, type usePurchasingT } from "../../_lib/purchasing-i18n";

/**
 * Turns the typed purchase lines into the API's `items`, looking each SKU up
 * with the inventory search (`INVENTORY_VIEW`, held by purchasing roles).
 * Returns the items, or a localized message for the first problem.
 */
export async function purchaseItems(
  text: string,
  { t, c, p }: ReturnType<typeof usePurchasingT>,
): Promise<{ variantId: string; quantity: number; unitCost: number }[] | string> {
  const parsed = parsePurchaseLines(text);
  if ("badLine" in parsed) {
    return fill(p.badLine, { n: parsed.badLine });
  }
  const items = [];
  for (const line of parsed.lines) {
    let found: InventoryItemView[];
    try {
      found = await staffApi<InventoryItemView[]>(
        `/api/v1/admin/inventory?${new URLSearchParams({ search: line.sku, pageSize: "20" })}`,
      );
    } catch (error) {
      return catalogError(t, c, error);
    }
    const variant = found.find((item) => item.sku.toUpperCase() === line.sku.toUpperCase());
    if (!variant) {
      return fill(p.skuNotFound, { sku: line.sku });
    }
    items.push({ variantId: variant.variantId, quantity: line.quantity, unitCost: line.unitCost });
  }
  return items;
}
