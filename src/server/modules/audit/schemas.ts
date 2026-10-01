import { z } from "zod";
import { pageQuery } from "@/server/modules/rbac/schemas";

/** Query schema of `GET /admin/audit-logs` (TASK-013, API §26). */

const timestamp = z.iso
  .datetime({ offset: true, message: "Use an ISO 8601 date-time, e.g. 2026-10-01T00:00:00Z." })
  .transform((value) => new Date(value));

export const listAuditLogsQuerySchema = z
  .object({
    ...pageQuery,
    actorType: z.enum(["SYSTEM", "EMPLOYEE", "CUSTOMER"]).optional(),
    actorId: z.uuid().optional(),
    action: z.string().trim().min(1).max(64).optional(),
    entityType: z.string().trim().min(1).max(64).optional(),
    entityId: z.string().trim().min(1).max(200).optional(),
    from: timestamp.optional(),
    to: timestamp.optional(),
  })
  .refine((query) => !query.from || !query.to || query.from < query.to, {
    message: "`from` must be before `to`.",
    path: ["from"],
  });
