import { z } from "zod";
import { pageQuery } from "@/server/modules/rbac/schemas";

/** Request schemas of the admin supplier endpoints (TASK-021, API §21, ADR-0026). */

export const SUPPLIER_NAME_MAX = 200;

const name = z.string().trim().min(1).max(SUPPLIER_NAME_MAX);
/** Digits with an optional leading `+`; spaces, hyphens and brackets allowed. Landlines too. */
const phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9][0-9 ()-]{4,29}$/, { message: "Invalid phone number." });
const email = z
  .email()
  .max(254)
  .transform((value) => value.toLowerCase());
const address = z.string().trim().min(1).max(500);
const notes = z.string().trim().min(1).max(2000);

export const supplierStatusSchema = z.enum(["ACTIVE", "INACTIVE"]);

export const createSupplierSchema = z.object({
  name,
  phone: phone.nullable().optional(),
  email: email.nullable().optional(),
  address: address.nullable().optional(),
  notes: notes.nullable().optional(),
});

export const updateSupplierSchema = z
  .object({
    name: name.optional(),
    /** `null` clears the field. */
    phone: phone.nullable().optional(),
    email: email.nullable().optional(),
    address: address.nullable().optional(),
    notes: notes.nullable().optional(),
    /** `INACTIVE` deactivates the supplier, `ACTIVE` brings it back. */
    status: supplierStatusSchema.optional(),
  })
  .refine((value) => Object.values(value).some((v) => v !== undefined), {
    message: "Provide at least one field to change.",
  });

export const listSuppliersQuerySchema = z.object({
  ...pageQuery,
  status: supplierStatusSchema.optional(),
  /** Matches the name, phone or email. */
  search: z.string().trim().min(1).max(100).optional(),
});

export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;
export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;
export type ListSuppliersQuery = z.infer<typeof listSuppliersQuerySchema>;
