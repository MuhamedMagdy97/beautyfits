"use client";

import { useState } from "react";
import { AuthCard, Field, Notice, submit, SubmitButton, TextLink } from "../../_components/ui";
import { staffPost } from "../../_lib/api";
import { errorMessage, useT } from "../../_lib/i18n";

/**
 * Staff password recovery (TASK-011): email → emailed code → new password.
 * The API answers the same for any email; a reset signs out every session (R29).
 */
export default function ForgotPasswordPage() {
  const t = useT();
  const [email, setEmail] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function run(action: () => Promise<void>) {
    setPending(true);
    setError(null);
    try {
      await action();
    } catch (failure) {
      setError(errorMessage(t, failure));
    } finally {
      setPending(false);
    }
  }

  const onEmail = (form: FormData) =>
    void run(async () => {
      const value = String(form.get("email") ?? "");
      await staffPost("/api/v1/employee-auth/forgot-password", { email: value });
      setEmail(value);
    });

  const onReset = (form: FormData) =>
    void run(async () => {
      await staffPost("/api/v1/employee-auth/reset-password", {
        email,
        code: String(form.get("code") ?? "").trim(),
        newPassword: form.get("newPassword"),
      });
      setDone(true);
    });

  return (
    <AuthCard title={t.resetTitle}>
      <Notice tone="error">{error}</Notice>
      {done ? (
        <Notice tone="info">{t.resetDone}</Notice>
      ) : email === null ? (
        <form key="email" onSubmit={submit(onEmail)}>
          <Notice tone="info">{t.resetIntro}</Notice>
          <Field label={t.email} name="email" type="email" autoComplete="username" />
          <SubmitButton pending={pending}>{t.sendCode}</SubmitButton>
        </form>
      ) : (
        <form key="reset" onSubmit={submit(onReset)}>
          <Notice tone="info">{t.codeSent}</Notice>
          <Field
            label={t.code}
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
          />
          <Field
            label={t.newPassword}
            name="newPassword"
            type="password"
            autoComplete="new-password"
          />
          <SubmitButton pending={pending}>{t.resetPassword}</SubmitButton>
        </form>
      )}
      <p className="mt-4 text-center">
        <TextLink href="/staff/login">{t.backToSignIn}</TextLink>
      </p>
    </AuthCard>
  );
}
