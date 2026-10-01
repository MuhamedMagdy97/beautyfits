import type { Prisma } from "@/generated/prisma/client";
import type { Db } from "@/server/db/transaction";
import { AppError } from "@/server/errors/app-error";
import { conflict } from "@/server/modules/catalog/errors";

/** Guards shared by the product, variant and product media services. */

type ProductRow = Prisma.ProductGetPayload<object>;

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

/** Archived products are kept for history only and no longer change (ADR-0019). */
export function assertProductChangeable(product: ProductRow): void {
  if (product.status === "ARCHIVED") {
    throw conflict("This product is archived and can no longer be changed.", {
      reason: "PRODUCT_ARCHIVED",
    });
  }
}
