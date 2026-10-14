"use client";

import { useState } from "react";
import { Field, Notice, submit, SubmitButton, TextLink } from "@/app/_components/ui";
import { AuthCard, signIn, useAction, VerifyEmail } from "../_components/auth";
import { StoreApiError, storePost } from "../_lib/api";
import { useT } from "../_lib/i18n";

/**
 * Customer sign-in (TASK-007): email + password with the cookie transport.
 * An unverified email (R26) switches to the email-code step.
 */
export function LoginForm({
  next,
  reason,
}: {
  next: string;
  reason: "expired" | "required" | null;
}) {
  const t = useT();
  const { error, pending, run } = useAction();
  const [verify, setVerify] = useState<{ email: string; password: string; sent: boolean } | null>(
    null,
  );

  const onLogin = (form: FormData) =>
    void run(async () => {
      const email = String(form.get("email") ?? "");
      const password = String(form.get("password") ?? "");
      try {
        await signIn(email, password, next);
      } catch (failure) {
        if (failure instanceof StoreApiError && failure.code === "AUTH_EMAIL_NOT_VERIFIED") {
          const sent = await storePost("/api/v1/auth/resend-otp", {
            email,
            purpose: "EMAIL_VERIFICATION",
          }).then(
            () => true,
            () => false,
          );
          setVerify({ email, password, sent });
          return;
        }
        throw failure;
      }
    });

  if (verify) {
    return (
      <AuthCard title={t.verifyTitle}>
        <VerifyEmail
          email={verify.email}
          password={verify.password}
          next={next}
          codeSent={verify.sent}
        />
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t.loginTitle}>
      <Notice tone="info">
        {reason === "expired" ? t.sessionExpired : reason === "required" ? t.signInRequired : null}
      </Notice>
      <Notice tone="error">{error}</Notice>
      <form method="post" onSubmit={submit(onLogin)}>
        <Field label={t.email} name="email" type="email" autoComplete="username" dir="ltr" />
        <Field label={t.password} name="password" type="password" autoComplete="current-password" />
        <SubmitButton pending={pending}>{t.signIn}</SubmitButton>
      </form>
      <div className="mt-6 flex flex-col items-center gap-2">
        <TextLink href="/forgot-password">{t.forgotPassword}</TextLink>
        <p className="text-sm text-ink-soft">
          {t.noAccount}{" "}
          <TextLink href={`/register?next=${encodeURIComponent(next)}`}>{t.register}</TextLink>
        </p>
      </div>
    </AuthCard>
  );
}
