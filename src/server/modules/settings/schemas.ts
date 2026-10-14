import { z } from "zod";
import { pageQuery } from "@/server/modules/rbac/schemas";

/** Request schemas of the settings endpoints (TASK-057, API §26). */

const KEY_MAX = 100;

/** The value is checked against the setting's own rule by the service. */
export const changeSettingSchema = z.object({
  value: z.union([z.number(), z.string(), z.boolean()]),
  reason: z
    .string()
    .trim()
    .max(1000)
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .optional(),
});

export const listSettingHistoryQuerySchema = z.object({
  ...pageQuery,
  key: z.string().trim().min(1).max(KEY_MAX).optional(),
});
