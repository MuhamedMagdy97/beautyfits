import type { Metadata } from "next";
import { safeNextPath } from "../_lib/api";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function RegisterPage({ searchParams }: PageProps<"/register">) {
  const { next } = await searchParams;
  return <RegisterForm next={safeNextPath(typeof next === "string" ? next : null)} />;
}
