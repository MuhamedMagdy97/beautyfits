import { z } from "zod";
import { normalizeEgyptianMobile, normalizeEmail } from "@/server/modules/auth/identifiers";
import {
  checkPasswordPolicy,
  PASSWORD_PROBLEM_MESSAGES,
} from "@/server/modules/auth/password-policy";
import { AUTH_POLICY } from "@/server/modules/auth/policy";

/** Request schemas of the customer auth endpoints (API contract §10). */

const email = z
  .string()
  .max(254)
  .transform(normalizeEmail)
  .pipe(z.email({ message: "Enter a valid email address." }));

/** A new password must satisfy the policy (Q156). */
const newPassword = z.string().superRefine((value, ctx) => {
  const problem = checkPasswordPolicy(value);
  if (problem) {
    ctx.addIssue({
      code: "custom",
      message: PASSWORD_PROBLEM_MESSAGES[problem],
      params: { code: problem },
    });
  }
});

/**
 * An existing password is only bounded, never policy-checked (a policy change
 * must not lock anyone out). The bound limits hashing work.
 */
const existingPassword = z.string().min(1).max(1024);

/** Egyptian mobile number, normalized to E.164 (R27). */
const phone = z
  .string()
  .max(32)
  .transform((value, ctx) => {
    const normalized = normalizeEgyptianMobile(value);
    if (normalized === null) {
      ctx.addIssue({
        code: "custom",
        message: "Enter an Egyptian mobile number starting with 010, 011, 012 or 015.",
        params: { code: "phone_invalid" },
      });
      return z.NEVER;
    }
    return normalized;
  });

export const registerSchema = z.object({
  email,
  password: newPassword,
  phone,
  fullName: z.string().trim().min(1).max(AUTH_POLICY.fullNameMaxLength),
  preferredLocale: z.enum(["ar", "en"]).optional(),
});

export const loginSchema = z.object({
  email,
  password: existingPassword,
});

export const refreshSchema = z.object({
  refreshToken: z.string().max(256).optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: existingPassword,
  newPassword,
});

/** A one-time code: 6 digits (TASK-008). Surrounding spaces are ignored. */
const otpCode = z
  .string()
  .trim()
  .regex(/^\d{6}$/, { message: "Enter the 6-digit code." });

export const verifyEmailSchema = z.object({ email, code: otpCode });

export const resendOtpSchema = z.object({
  email,
  purpose: z.enum(["EMAIL_VERIFICATION", "PASSWORD_RESET"]),
});

export const forgotPasswordSchema = z.object({ email });

export const verifyRecoverySchema = z.object({ email, code: otpCode });

export const resetPasswordSchema = z.object({
  resetToken: z.string().min(1).max(256),
  newPassword,
});

// Employee auth (TASK-011, API contract "TASK-011 Amendments").

const opaqueToken = z.string().min(1).max(256);

export const employeeLoginSchema = z.object({
  email,
  password: existingPassword,
  /** Trusted-device token from an earlier email code (Bearer clients; R28). */
  deviceToken: opaqueToken.optional(),
});

export const employeeVerifyOtpSchema = z.object({ loginTicket: opaqueToken, code: otpCode });

export const employeeResendOtpSchema = z.object({ loginTicket: opaqueToken });

export const employeeForgotPasswordSchema = z.object({ email });

export const employeeResetPasswordSchema = z.object({ email, code: otpCode, newPassword });
