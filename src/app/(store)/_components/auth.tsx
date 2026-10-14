"use client";

import { useState } from "react";
import { Field, Notice, submit, SubmitButton } from "@/app/_components/ui";
import { storePost } from "../_lib/api";
import { errorMessage, useT } from "../_lib/i18n";

/** Shared pieces of the customer sign-in, registration and recovery pages (TASK-058). */

export function AuthCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="flex flex-1 items-start justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-xl border border-line bg-white p-8 shadow-sm">
        <h1 className="mb-6 font-[family-name:var(--font-display)] text-3xl text-ink">{title}</h1>
        {children}
      </div>
    </main>
  );
}

/** Runs a form action with a pending flag and a localized error message. */
export function useAction() {
  const t = useT();
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
  return { error, pending, run };
}

/** Signs in with the cookie transport and leaves for `next` with a full page load. */
export async function signIn(email: string, password: string, next: string): Promise<void> {
  await storePost("/api/v1/auth/login", { email, password });
  // A full load lets the storefront read the new session and merge the guest cart.
  window.location.assign(next);
}

/**
 * Email verification step (User Flows §3.1): the 6-digit code, resend after
 * the cooldown the API enforces, then sign-in with the password just typed.
 */
export function VerifyEmail({
  email,
  password,
  next,
  codeSent,
}: {
  email: string;
  password: string;
  next: string;
  codeSent: boolean;
}) {
  const t = useT();
  const { error, pending, run } = useAction();
  const [info, setInfo] = useState(codeSent ? t.codeSent.replace("{email}", email) : t.codeNotSent);

  const onVerify = (form: FormData) =>
    void run(async () => {
      await storePost("/api/v1/auth/verify-email-otp", {
        email,
        code: String(form.get("code") ?? "").trim(),
      });
      await signIn(email, password, next);
    });

  const onResend = () =>
    void run(async () => {
      await storePost("/api/v1/auth/resend-otp", { email, purpose: "EMAIL_VERIFICATION" });
      setInfo(t.codeResent);
    });

  return (
    <form method="post" onSubmit={submit(onVerify)}>
      <Notice tone="error">{error}</Notice>
      <Notice tone="info">{info}</Notice>
      <CodeField />
      <SubmitButton pending={pending}>{t.verify}</SubmitButton>
      <button
        type="button"
        onClick={onResend}
        disabled={pending}
        className="mt-4 w-full text-sm text-plum underline-offset-4 hover:underline"
      >
        {t.resendCode}
      </button>
    </form>
  );
}

export function CodeField() {
  const t = useT();
  return (
    <Field
      label={t.code}
      name="code"
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="[0-9]{6}"
      maxLength={6}
      dir="ltr"
    />
  );
}
