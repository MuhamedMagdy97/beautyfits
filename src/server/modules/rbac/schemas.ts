import { z } from "zod";
import { normalizeEmail } from "@/server/modules/auth/identifiers";
import {
  checkPasswordPolicy,
  PASSWORD_PROBLEM_MESSAGES,
} from "@/server/modules/auth/password-policy";
import { isPermissionCode, type PermissionCode } from "@/server/modules/rbac/catalog";

/** Request schemas of the employee, role and invitation endpoints (TASK-012, API §25). */

const DISPLAY_NAME_MAX = 100;
const DEPARTMENT_MAX = 100;
const ROLE_NAME_MAX = 60;
const ROLE_DESCRIPTION_MAX = 500;
const MAX_ROLES = 50;

const email = z
  .string()
  .max(254)
  .transform(normalizeEmail)
  .pipe(z.email({ message: "Enter a valid email address." }));

const displayName = z.string().trim().min(1).max(DISPLAY_NAME_MAX);

/** Blank means "no department". */
const department = z
  .string()
  .trim()
  .max(DEPARTMENT_MAX)
  .transform((value) => (value === "" ? null : value))
  .nullable();

const roleIds = z.array(z.uuid()).max(MAX_ROLES);

/** Levels that can be given through the API; nobody becomes Owner this way. */
const assignableLevel = z.enum(["ADMIN", "MANAGER", "EMPLOYEE"]);

export const uuidParam = z.uuid();

export const inviteEmployeeSchema = z.object({
  email,
  displayName,
  department: department.optional(),
  level: assignableLevel,
  roleIds: roleIds.default([]),
});

export const updateEmployeeSchema = z
  .object({
    displayName: displayName.optional(),
    department: department.optional(),
    level: assignableLevel.optional(),
    roleIds: roleIds.optional(),
  })
  .refine((value) => Object.values(value).some((v) => v !== undefined), {
    message: "Provide at least one field to change.",
  });

const pageQuery = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(24),
};

export const listEmployeesQuerySchema = z.object({
  ...pageQuery,
  status: z.enum(["ACTIVE", "DEACTIVATED"]).optional(),
  level: z.enum(["OWNER", "ADMIN", "MANAGER", "EMPLOYEE"]).optional(),
  search: z.string().trim().min(1).max(100).optional(),
});

export const listInvitationsQuerySchema = z.object({
  ...pageQuery,
  status: z.enum(["PENDING", "ACCEPTED", "REVOKED", "EXPIRED"]).optional(),
});

const permissionCode = z
  .string()
  .refine((value): value is PermissionCode => isPermissionCode(value), {
    message: "Unknown permission code.",
    params: { code: "permission_unknown" },
  });

const permissionList = z
  .array(permissionCode)
  .max(200)
  .transform((codes) => [...new Set(codes)]);

const roleName = z.string().trim().min(1).max(ROLE_NAME_MAX);

const roleDescription = z
  .string()
  .trim()
  .max(ROLE_DESCRIPTION_MAX)
  .transform((value) => (value === "" ? null : value))
  .nullable();

export const createRoleSchema = z.object({
  name: roleName,
  description: roleDescription.optional(),
  permissions: permissionList,
});

export const updateRoleSchema = z
  .object({
    name: roleName.optional(),
    description: roleDescription.optional(),
    permissions: permissionList.optional(),
  })
  .refine((value) => Object.values(value).some((v) => v !== undefined), {
    message: "Provide at least one field to change.",
  });

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

export const acceptInvitationSchema = z.object({
  invitationToken: z.string().min(1).max(256),
  password: newPassword,
});
