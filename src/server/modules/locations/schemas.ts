import { z } from "zod";

/** Request schemas of the location endpoints (TASK-009, Business Spec R32, ADR-0030). */

const name = z.string().trim().min(1).max(100);
const status = z.enum(["ACTIVE", "INACTIVE"]);

const atLeastOne = (value: Record<string, unknown>) =>
  Object.values(value).some((v) => v !== undefined);
const atLeastOneMessage = { message: "Provide at least one field to change." };

export const updateGovernorateSchema = z
  .object({ nameAr: name.optional(), nameEn: name.optional(), status: status.optional() })
  .refine(atLeastOne, atLeastOneMessage);

export const createAreaSchema = z.object({ nameAr: name, nameEn: name });

export const updateAreaSchema = updateGovernorateSchema;

export type UpdateLocationInput = z.infer<typeof updateGovernorateSchema>;
export type CreateAreaInput = z.infer<typeof createAreaSchema>;
