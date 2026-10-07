import { safeNextPath } from "../../_lib/navigation";
import { LoginForm } from "./login-form";

export default async function LoginPage({ searchParams }: PageProps<"/staff/login">) {
  const { next, reason } = await searchParams;
  return (
    <LoginForm
      next={safeNextPath(typeof next === "string" ? next : null)}
      reason={reason === "expired" || reason === "signed-out" ? reason : null}
    />
  );
}
