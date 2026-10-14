"use client";

import { useState } from "react";
import { Field, Notice, submit, SubmitButton, TextLink } from "@/app/_components/ui";
import { AuthCard, CodeField, useAction } from "../_components/auth";
import { storePost } from "../_lib/api";
import { useT } from "../_lib/i18n";

/**
 * Customer password recovery (User Flows §3.2, TASK-008): email → emailed code
 * → new password. The API answers the same for any email; a reset signs out
 * every session (R23).
 */
export default function ForgotPasswordPage() {
  const t = useT();
  const { error, pending, run } = useAction();
  const [email, setEmail] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // Kept so a refused new password (policy) can be retried without a new code.
  const [resetToken, setResetToken] = useState<string | null>(null);

  const onEmail = (form: FormData) =>
    void run(async () => {
      const value = String(form.get("email") ?? "");
      await storePost("/api/v1/auth/forgot-password", { email: value });
      setEmail(value);
      setInfo(t.codeSent.replace("{email}", value));
    });

  const onReset = (form: FormData) =>
    void run(async () => {
      const token =
        resetToken ??
        (
          await storePost<{ resetToken: string }>("/api/v1/auth/verify-recovery-otp", {
            email,
            code: String(form.get("code") ?? "").trim(),
          })
        ).resetToken;
      setResetToken(token);
      await storePost("/api/v1/auth/reset-password", {
        resetToken: token,
        newPassword: form.get("newPassword"),
      });
      setDone(true);
    });

  const onResend = () =>
    void run(async () => {
      await storePost("/api/v1/auth/resend-otp", { email, purpose: "PASSWORD_RESET" });
      setInfo(t.codeResent);
    });

  return (
    <AuthCard title={t.forgotTitle}>
      <Notice tone="error">{error}</Notice>
      {done ? (
        <Notice tone="info">{t.resetDone}</Notice>
      ) : email === null ? (
        <form method="post" key="email" onSubmit={submit(onEmail)}>
          <Notice tone="info">{t.forgotIntro}</Notice>
          <Field label={t.email} name="email" type="email" autoComplete="username" dir="ltr" />
          <SubmitButton pending={pending}>{t.sendCode}</SubmitButton>
        </form>
      ) : (
        <form method="post" key="reset" onSubmit={submit(onReset)}>
          <Notice tone="info">{info}</Notice>
          {resetToken ? null : <CodeField />}
          <Field
            label={t.newPassword}
            name="newPassword"
            type="password"
            autoComplete="new-password"
          />
          <SubmitButton pending={pending}>{t.resetPassword}</SubmitButton>
          <button
            type="button"
            onClick={onResend}
            disabled={pending}
            className="mt-4 w-full text-sm text-plum underline-offset-4 hover:underline"
          >
            {t.resendCode}
          </button>
        </form>
      )}
      <p className="mt-6 text-center">
        <TextLink href="/login">{t.backToSignIn}</TextLink>
      </p>
    </AuthCard>
  );
}
