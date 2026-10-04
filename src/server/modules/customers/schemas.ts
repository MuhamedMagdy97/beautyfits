import { z } from "zod";
import {
  egyptianMobileSchema,
  emailSchema,
  existingPasswordSchema,
} from "@/server/modules/auth/schemas";
import { AUTH_POLICY } from "@/server/modules/auth/policy";

/** Request schemas of the /me endpoints (TASK-009, API §11, ADR-0030). */

const EARLIEST_BIRTH_DATE = "1900-01-01";

/** `YYYY-MM-DD`, from 1900 up to today (UTC). */
const dateOfBirth = z.iso
  .date({ message: "Use a date such as 1995-04-30." })
  .refine(
    (value) => value >= EARLIEST_BIRTH_DATE && value <= new Date().toISOString().slice(0, 10),
    {
      message: "Enter a real date of birth.",
    },
  );

export const updateProfileSchema = z
  .object({
    fullName: z.string().trim().min(1).max(AUTH_POLICY.fullNameMaxLength).optional(),
    preferredLocale: z.enum(["ar", "en"]).optional(),
    /** `null` clears it. */
    dateOfBirth: dateOfBirth.nullable().optional(),
  })
  .refine((value) => Object.values(value).some((v) => v !== undefined), {
    message: "Provide at least one field to change.",
  });

export const changeEmailSchema = z.object({
  currentPassword: existingPasswordSchema,
  newEmail: emailSchema,
});

export const changePhoneSchema = z.object({
  currentPassword: existingPasswordSchema,
  newPhone: egyptianMobileSchema,
});

export const verifyChangeSchema = z.object({
  code: z.string().regex(/^\d{6}$/, { message: "Enter the 6-digit code." }),
});

// ---------------------------------------------------------------------------
// Addresses (DB design §3.3, R32)

const text = (max: number) => z.string().trim().min(1).max(max);
/** Optional text; blank or `null` clears it. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .optional();

const addressFields = {
  label: optionalText(50),
  recipientName: text(AUTH_POLICY.fullNameMaxLength),
  phone: egyptianMobileSchema,
  areaId: z.uuid({ message: "Choose an area from the list." }),
  city: optionalText(100),
  street: text(300),
  building: optionalText(50),
  floor: optionalText(20),
  apartment: optionalText(20),
  landmark: optionalText(200),
  notes: optionalText(500),
};

export const createAddressSchema = z.object(addressFields);

export const updateAddressSchema = z
  .object({
    ...addressFields,
    recipientName: addressFields.recipientName.optional(),
    phone: addressFields.phone.optional(),
    areaId: addressFields.areaId.optional(),
    street: addressFields.street.optional(),
  })
  .refine((value) => Object.values(value).some((v) => v !== undefined), {
    message: "Provide at least one field to change.",
  });

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type CreateAddressInput = z.infer<typeof createAddressSchema>;
export type UpdateAddressInput = z.infer<typeof updateAddressSchema>;
