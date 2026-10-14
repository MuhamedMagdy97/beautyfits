"use client";

import { useState } from "react";
import { Field, Notice, submit, SubmitButton, TextLink } from "@/app/_components/ui";
import { AuthCard, useAction, VerifyEmail } from "../_components/auth";
import { storePost } from "../_lib/api";
import { useLang, useT } from "../_lib/i18n";

/**
 * Customer registration (User Flows §3.1, R25–R27): account data, then the
 * emailed code; the API validates everything (password policy, Egyptian
 * mobile) and the page only shows its answer.
 */
export function RegisterForm({ next }: { next: string }) {
  const t = useT();
  const lang = useLang();
  const { error, pending, run } = useAction();
  const [verify, setVerify] = useState<{ email: string; password: string; sent: boolean } | null>(
    null,
  );

  const onRegister = (form: FormData) =>
    void run(async () => {
      const email = String(form.get("email") ?? "");
      const password = String(form.get("password") ?? "");
      const created = await storePost<{ verificationCodeSent: boolean }>("/api/v1/auth/register", {
        fullName: form.get("fullName"),
        email,
        phone: form.get("phone"),
        password,
        preferredLocale: lang,
      });
      setVerify({ email, password, sent: created.verificationCodeSent });
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
    <AuthCard title={t.registerTitle}>
      <Notice tone="error">{error}</Notice>
      <form method="post" onSubmit={submit(onRegister)}>
        <Field label={t.fullName} name="fullName" autoComplete="name" maxLength={100} />
        <Field label={t.email} name="email" type="email" autoComplete="email" dir="ltr" />
        <Field
          label={t.phone}
          name="phone"
          type="tel"
          autoComplete="tel"
          placeholder={t.phoneHint}
          dir="ltr"
        />
        <Field
          label={t.password}
          name="password"
          type="password"
          autoComplete="new-password"
          aria-describedby="password-hint"
        />
        <p id="password-hint" className="-mt-3 mb-4 text-xs text-ink-soft">
          {t.passwordHint}
        </p>
        <SubmitButton pending={pending}>{t.register}</SubmitButton>
      </form>
      <p className="mt-6 text-center text-sm text-ink-soft">
        {t.haveAccount}{" "}
        <TextLink href={`/login?next=${encodeURIComponent(next)}`}>{t.signIn}</TextLink>
      </p>
    </AuthCard>
  );
}
