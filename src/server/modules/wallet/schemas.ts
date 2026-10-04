import { z } from "zod";
import { pageQuery } from "@/server/modules/rbac/schemas";

/** `POST /admin/customers/{id}/wallet/adjust` (Q78): a credit or a debit, with a reason. */
export const adjustWalletSchema = z.object({
  direction: z.enum(["CREDIT", "DEBIT"]),
  /** Piastres; far below 2^53. */
  amount: z
    .int()
    .min(1)
    .max(1_000_000_000_000)
    .transform((value) => BigInt(value)),
  reason: z.string().trim().min(1).max(500),
});

export const walletTransactionsQuerySchema = z.object({ ...pageQuery });

export type AdjustWalletInput = z.infer<typeof adjustWalletSchema>;
export type WalletTransactionsQuery = z.infer<typeof walletTransactionsQuerySchema>;
