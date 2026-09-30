import type { z } from "zod";
import { AppError } from "@/server/errors/app-error";

/**
 * Server-side input validation (ADR-0005). Every route validates its input
 * with a zod schema through these helpers; failures become VALIDATION_ERROR
 * with per-field issues. Client-side validation is never trusted.
 */

export interface ValidationIssue {
  path: string;
  code: string;
  message: string;
}

/**
 * A custom issue may carry a more specific stable code in `params.code`
 * (e.g. `password_common`), which replaces zod's generic `custom`.
 */
function issueCode(issue: z.core.$ZodIssue): string {
  if (issue.code === "custom" && typeof issue.params?.code === "string") {
    return issue.params.code;
  }
  return issue.code;
}

export function toValidationError(error: z.ZodError): AppError {
  const issues: ValidationIssue[] = error.issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    code: issueCode(issue),
    message: issue.message,
  }));
  return new AppError("VALIDATION_ERROR", "Request validation failed.", {
    details: { issues },
  });
}

export function parseWith<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw toValidationError(result.error);
  }
  return result.data;
}

export async function parseJsonBody<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<z.output<S>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new AppError("VALIDATION_ERROR", "Request body must be valid JSON.", {
      details: { issues: [{ path: "", code: "invalid_json", message: "Malformed JSON body" }] },
    });
  }
  return parseWith(schema, body);
}

/**
 * Like `parseJsonBody`, but an empty body is validated as `{}` (for endpoints
 * whose fields are all optional, e.g. a cookie-based refresh).
 */
export async function parseOptionalJsonBody<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<z.output<S>> {
  const text = await request.text();
  if (text.trim() === "") {
    return parseWith(schema, {});
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new AppError("VALIDATION_ERROR", "Request body must be valid JSON.", {
      details: { issues: [{ path: "", code: "invalid_json", message: "Malformed JSON body" }] },
    });
  }
  return parseWith(schema, body);
}

/**
 * Validates URL query parameters. Repeated keys become arrays; schemas should
 * use z.coerce for numeric values such as page/pageSize.
 */
export function parseQuery<S extends z.ZodType>(request: Request, schema: S): z.output<S> {
  const params = new URL(request.url).searchParams;
  const raw: Record<string, string | string[]> = {};
  for (const key of new Set(params.keys())) {
    const values = params.getAll(key);
    raw[key] = values.length > 1 ? values : values[0];
  }
  return parseWith(schema, raw);
}
