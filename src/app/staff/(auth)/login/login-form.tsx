"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthCard, Field, Notice, submit, SubmitButton, TextLink } from "../../_components/ui";
import { staffPost } from "../../_lib/api";
import { errorMessage, useT } from "../../_lib/i18n";

interface Ticket {
  otpRequired: true;
  loginTicket: string;
}

/**
 * Employee sign-in (TASK-011 flow): password, then an emailed code unless
 * this device is trusted (R28). Tokens and the trusted device are set as
 * HttpOnly cookies by the API.
 */
export function LoginForm({
  next,
  reason,
}: {
  next: string;
  reason: "expired" | "signed-out" | null;
}) {
  const t = useT();
  const router = useRouter();
  const [ticket, setTicket] = useState<string | null>(null);
  // A dictionary key, so the notice follows a language switch.
  const [info, setInfo] = useState<
    "sessionExpired" | "signedOut" | "codeSent" | "codeResent" | null
  >(reason === "expired" ? "sessionExpired" : reason === "signed-out" ? "signedOut" : null);
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

  function signedIn(result: unknown) {
    if (result && typeof result === "object" && "otpRequired" in result) {
      setTicket((result as Ticket).loginTicket);
      setInfo("codeSent");
    } else {
      router.replace(next);
    }
  }

  function onPassword(form: FormData) {
    void run(async () => {
      signedIn(
        await staffPost("/api/v1/employee-auth/login", {
          email: form.get("email"),
          password: form.get("password"),
        }),
      );
    });
  }

  function onCode(form: FormData) {
    void run(async () => {
      await staffPost("/api/v1/employee-auth/verify-otp", {
        loginTicket: ticket,
        code: String(form.get("code") ?? "").trim(),
      });
      router.replace(next);
    });
  }

  function onResend() {
    void run(async () => {
      const result = await staffPost<Ticket>("/api/v1/employee-auth/resend-otp", {
        loginTicket: ticket,
      });
      setTicket(result.loginTicket);
      setInfo("codeResent");
    });
  }

  return (
    <AuthCard title={t.signIn}>
      <Notice tone="info">{info && t[info]}</Notice>
      <Notice tone="error">{error}</Notice>
      {ticket === null ? (
        <form key="password" onSubmit={submit(onPassword)}>
          <Field label={t.email} name="email" type="email" autoComplete="username" />
          <Field
            label={t.password}
            name="password"
            type="password"
            autoComplete="current-password"
          />
          <SubmitButton pending={pending}>{t.continue}</SubmitButton>
          <p className="mt-4 text-center">
            <TextLink href="/staff/forgot-password">{t.forgotPassword}</TextLink>
          </p>
        </form>
      ) : (
        <form key="code" onSubmit={submit(onCode)}>
          <Field
            label={t.code}
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
          />
          <SubmitButton pending={pending}>{t.verify}</SubmitButton>
          <p className="mt-4 flex justify-between gap-4">
            <button
              type="button"
              onClick={onResend}
              disabled={pending}
              className="text-sm text-plum underline-offset-4 hover:underline disabled:opacity-60"
            >
              {t.resendCode}
            </button>
            <button
              type="button"
              onClick={() => {
                setTicket(null);
                setInfo(null);
                setError(null);
              }}
              className="text-sm text-ink-soft underline-offset-4 hover:underline"
            >
              {t.backToSignIn}
            </button>
          </p>
        </form>
      )}
    </AuthCard>
  );
}
