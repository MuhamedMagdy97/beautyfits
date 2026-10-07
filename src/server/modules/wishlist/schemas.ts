import { z } from "zod";

/** Request schemas of the wishlist endpoints (TASK-042, API §19). */

export const addWishlistItemSchema = z.object({ variantId: z.uuid() });
