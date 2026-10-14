import type { Metadata } from "next";
import { safeNextPath } from "../_lib/api";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next, reason } = await searchParams;
  return (
    <LoginForm
      next={safeNextPath(typeof next === "string" ? next : null)}
      reason={reason === "expired" || reason === "required" ? reason : null}
    />
  );
}
