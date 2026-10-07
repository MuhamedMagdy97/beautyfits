"use client";

import { useState } from "react";
import { AuthCard, Field, Notice, submit, SubmitButton, TextLink } from "../../_components/ui";
import { staffPost } from "../../_lib/api";
import { errorMessage, useT } from "../../_lib/i18n";

/** The invitation token travels in the URL fragment, which never reaches a server (ADR-0016). */
function invitationToken(): string | null {
  return new URLSearchParams(window.location.hash.slice(1)).get("token");
}

/**
 * Accept a staff invitation (Q64, TASK-012): the invitee only chooses a
 * password. The account is not signed in; the first sign-in asks for an
 * email code (R28).
 */
export default function AcceptInvitationPage() {
  const t = useT();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const onSubmit = (form: FormData) => {
    const token = invitationToken();
    if (!token) {
      setError(t.invitationMissing);
      return;
    }
    setPending(true);
    setError(null);
    staffPost("/api/v1/employee-auth/accept-invitation", {
      invitationToken: token,
      password: form.get("password"),
    })
      .then(() => {
        // The token is single use: drop it from the address bar and history.
        window.history.replaceState(null, "", window.location.pathname);
        setDone(true);
      })
      .catch((failure: unknown) => setError(errorMessage(t, failure)))
      .finally(() => setPending(false));
  };

  return (
    <AuthCard title={t.acceptTitle}>
      <Notice tone="error">{error}</Notice>
      {done ? (
        <>
          <Notice tone="info">{t.acceptDone}</Notice>
          <TextLink href="/staff/login">{t.signIn}</TextLink>
        </>
      ) : (
        <form onSubmit={submit(onSubmit)}>
          <Notice tone="info">{t.acceptIntro}</Notice>
          <Field label={t.password} name="password" type="password" autoComplete="new-password" />
          <SubmitButton pending={pending}>{t.createAccount}</SubmitButton>
        </form>
      )}
    </AuthCard>
  );
}
