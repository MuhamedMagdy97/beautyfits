import type { Prisma } from "@/generated/prisma/client";
import type { Db } from "@/server/db/transaction";
import { AppError } from "@/server/errors/app-error";
import { conflict } from "@/server/modules/catalog/errors";

/** Guards shared by the product, variant and product media services. */

type ProductRow = Prisma.ProductGetPayload<object>;
type VariantRow = Prisma.ProductVariantGetPayload<object>;

export function productNotFound(): AppError {
  return new AppError("NOT_FOUND", "Product not found.");
}

/**
 * Locks the product row, so that changes of one product's variants and
 * images (adding, moving the default or main image, archiving, removing) run
 * one at a time.
 */
export async function lockProduct(tx: Db, productId: string): Promise<ProductRow> {
  const locked = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM products WHERE id = ${productId}::uuid FOR UPDATE`;
  if (locked.length === 0) {
    throw productNotFound();
  }
  return tx.product.findUniqueOrThrow({ where: { id: productId } });
}

export function variantNotFound(): AppError {
  return new AppError("NOT_FOUND", "Variant not found.");
}

/** Finds the variant and locks its product (see `lockProduct`). */
export async function lockVariant(
  tx: Db,
  variantId: string,
): Promise<{ product: ProductRow; variant: VariantRow }> {
  const found = await tx.productVariant.findUnique({
    where: { id: variantId },
    select: { productId: true },
  });
  if (!found) {
    throw variantNotFound();
  }
  const product = await lockProduct(tx, found.productId);
  const variant = await tx.productVariant.findUniqueOrThrow({ where: { id: variantId } });
  return { product, variant };
}

/** Archived variants are final in v1 (ADR-0019). */
export function assertVariantActive(variant: VariantRow): void {
  if (variant.status === "ARCHIVED") {
    throw conflict("This variant is archived and can no longer be changed.", {
      reason: "VARIANT_ARCHIVED",
    });
  }
}

/** Archived products are kept for history only and no longer change (ADR-0019). */
export function assertProductChangeable(product: ProductRow): void {
  if (product.status === "ARCHIVED") {
    throw conflict("This product is archived and can no longer be changed.", {
      reason: "PRODUCT_ARCHIVED",
    });
  }
}
