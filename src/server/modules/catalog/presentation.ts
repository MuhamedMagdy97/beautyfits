import type { ProductView, VariantView } from "@/server/modules/catalog/products-service";
import type { PermissionSet } from "@/server/modules/rbac/authorization";

/**
 * Cost data is sensitive (Business Spec Q74, Q80; API §13 "Cost fields are
 * returned only to callers with `VIEW_COST_PRICE`"). Every admin route that
 * returns a product or variant passes it through these before responding.
 */

export function canViewCost(permissions: PermissionSet): boolean {
  return permissions.has("VIEW_COST_PRICE");
}

export function presentVariant(view: VariantView, permissions: PermissionSet): VariantView {
  if (canViewCost(permissions)) {
    return view;
  }
  const withoutCosts = { ...view };
  delete withoutCosts.costs;
  return withoutCosts;
}

export function presentVariants(views: VariantView[], permissions: PermissionSet): VariantView[] {
  return views.map((view) => presentVariant(view, permissions));
}

export function presentProduct(view: ProductView, permissions: PermissionSet): ProductView {
  return { ...view, variants: presentVariants(view.variants, permissions) };
}
