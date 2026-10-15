"use client";

import { useState } from "react";
import { TextInput } from "../../_components/address-form";
import {
  Button,
  CustomerOnly,
  Loaded,
  Page,
  PageTitle,
  useRun,
  useStoreData,
} from "../../_components/shop";
import type { MarketingConsents } from "../../_lib/account";
import { StoreApiError, storePost, storeSend } from "../../_lib/api";
import { useLang, useT, type Dictionary } from "../../_lib/i18n";
import type { Lang } from "../../_lib/lang";
import { useShopper } from "../../_lib/session";
import { AccountNav } from "../account-nav";

const card = "max-w-xl space-y-4 rounded-xl border border-line bg-white p-6";
const heading = "font-[family-name:var(--font-display)] text-xl text-plum";

/**
 * Account settings (API "TASK-009", "TASK-046" Amendments): email and mobile
 * changes with the current password and an emailed code, marketing consent per
 * channel, and closing the account (R34).
 */
export function SettingsView() {
  const t = useT();
  return (
    <Page>
      <PageTitle>{t.my.settings}</PageTitle>
      <AccountNav />
      <CustomerOnly>
        <div className="space-y-6">
          <ChangeContact kind="email" />
          <ChangeContact kind="phone" />
          <ChangePassword />
          <Consents />
          <Deactivate />
        </div>
      </CustomerOnly>
    </Page>
  );
}

/** Here a wrong password is the current one, not a sign-in ("email or password"). */
async function withPassword<T>(request: Promise<T>): Promise<T> {
  try {
    return await request;
  } catch (error) {
    if (error instanceof StoreApiError && error.code === "AUTH_INVALID_CREDENTIALS") {
      throw new StoreApiError(error.status, "WRONG_PASSWORD");
    }
    throw error;
  }
}

/** Two steps: password + new value → code sent; then the code. */
function ChangeContact({ kind }: { kind: "email" | "phone" }) {
  const t = useT();
  const { reload } = useShopper();
  const { run, pending, notice, say } = useRun();
  const [codeSent, setCodeSent] = useState(false);
  const email = kind === "email";
  const path = email ? "/api/v1/me/change-email" : "/api/v1/me/change-phone";
  return (
    <section className={card}>
      <h2 className={heading}>{email ? t.settingsPage.changeEmail : t.settingsPage.changePhone}</h2>
      {notice}
      {codeSent ? (
        <form
          method="post"
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            const code = String(new FormData(event.currentTarget).get("code") ?? "").trim();
            void run(async () => {
              await storePost(`${path}/verify`, { code });
              setCodeSent(false);
              reload();
              say({
                tone: "info",
                text: email ? t.settingsPage.emailChanged : t.settingsPage.phoneChanged,
              });
            });
          }}
        >
          <TextInput
            label={t.code}
            name="code"
            required
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            dir="ltr"
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" disabled={pending}>
              {t.verify}
            </Button>
            <Button onClick={() => setCodeSent(false)}>{t.accountPage.cancel}</Button>
          </div>
        </form>
      ) : (
        <form
          method="post"
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const value = String(form.get("value") ?? "").trim();
            void run(async () => {
              const sent = await withPassword(
                storePost<{ codeSent: boolean }>(path, {
                  currentPassword: String(form.get("currentPassword") ?? ""),
                  ...(email ? { newEmail: value } : { newPhone: value }),
                }),
              );
              setCodeSent(true);
              say(
                sent.codeSent
                  ? {
                      tone: "info",
                      text: email
                        ? t.settingsPage.codeToNewEmail
                        : t.settingsPage.codeToAccountEmail,
                    }
                  : { tone: "error", text: t.codeNotSent },
              );
            });
          }}
        >
          <TextInput
            label={email ? t.settingsPage.newEmail : t.settingsPage.newPhone}
            name="value"
            type={email ? "email" : "tel"}
            required
            autoComplete={email ? "email" : "tel"}
            dir="ltr"
          />
          <TextInput
            label={t.settingsPage.currentPassword}
            name="currentPassword"
            type="password"
            required
            autoComplete="current-password"
          />
          <Button type="submit" variant="primary" disabled={pending}>
            {t.sendCode}
          </Button>
        </form>
      )}
    </section>
  );
}

/** Keeps this session and signs out the others (R23). */
function ChangePassword() {
  const t = useT();
  const { run, pending, notice } = useRun();
  return (
    <form
      method="post"
      className={card}
      onSubmit={(event) => {
        event.preventDefault();
        const formElement = event.currentTarget;
        const form = new FormData(formElement);
        void run(async () => {
          await withPassword(
            storePost("/api/v1/auth/change-password", {
              currentPassword: String(form.get("currentPassword") ?? ""),
              newPassword: String(form.get("newPassword") ?? ""),
            }),
          );
          formElement.reset();
        }, t.settingsPage.passwordChanged);
      }}
    >
      <h2 className={heading}>{t.settingsPage.changePassword}</h2>
      {notice}
      <TextInput
        label={t.settingsPage.currentPassword}
        name="currentPassword"
        type="password"
        required
        autoComplete="current-password"
      />
      <TextInput
        label={t.newPassword}
        name="newPassword"
        type="password"
        required
        minLength={12}
        autoComplete="new-password"
      />
      <p className="text-xs text-ink-soft">{t.passwordHint}</p>
      <Button type="submit" variant="primary" disabled={pending}>
        {t.accountPage.save}
      </Button>
    </form>
  );
}

/** Marketing consent per channel, never pre-enabled (Q59, Q60). */
function Consents() {
  const t = useT();
  const { state, reload, set } = useStoreData<MarketingConsents>("/api/v1/me/marketing-consents");
  const { run, pending, notice } = useRun();
  return (
    <section className={card}>
      <h2 className={heading}>{t.settingsPage.marketing}</h2>
      <p className="text-sm text-ink-soft">{t.settingsPage.marketingIntro}</p>
      {notice}
      <Loaded load={state} reload={reload}>
        {(consents) => (
          <div className="space-y-3">
            {(["email", "whatsapp"] as const).map((channel) => (
              <label key={channel} className="flex items-center gap-3 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={consents[channel].optedIn}
                  disabled={pending}
                  onChange={(event) => {
                    const optedIn = event.target.checked;
                    void run(async () => {
                      set(
                        await storeSend<MarketingConsents>(
                          "PATCH",
                          "/api/v1/me/marketing-consents",
                          { [channel]: optedIn },
                        ),
                      );
                    }, t.accountPage.saved);
                  }}
                />
                {channel === "email"
                  ? t.settingsPage.marketingEmail
                  : t.settingsPage.marketingWhatsapp}
              </label>
            ))}
          </div>
        )}
      </Loaded>
    </section>
  );
}

/** The open items the API names when closing is refused (R34). */
function openItemsMessage(t: Dictionary, lang: Lang, error: unknown): string | null {
  if (!(error instanceof StoreApiError) || error.details.reason !== "ACCOUNT_HAS_OPEN_ITEMS") {
    return null;
  }
  const items = Array.isArray(error.details.openItems) ? (error.details.openItems as string[]) : [];
  return t.settingsPage.cannotClose.replace(
    "{items}",
    items.map((item) => t.settingsPage.openItems[item] ?? item).join(lang === "ar" ? "، " : ", "),
  );
}

/** Closing the account (R34): password and an explicit acknowledgement. */
function Deactivate() {
  const t = useT();
  const lang = useLang();
  const { run, pending, notice, say } = useRun();
  const [understood, setUnderstood] = useState(false);
  return (
    <section className={`${card} border-danger`}>
      <h2 className={`${heading} text-danger`}>{t.settingsPage.deactivate}</h2>
      <p className="text-sm text-ink">{t.settingsPage.deactivateIntro}</p>
      {notice}
      <form
        method="post"
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          const currentPassword = String(
            new FormData(event.currentTarget).get("currentPassword") ?? "",
          );
          void run(async () => {
            try {
              await withPassword(storePost("/api/v1/me/deactivate", { currentPassword }));
            } catch (error) {
              const open = openItemsMessage(t, lang, error);
              if (!open) {
                throw error;
              }
              say({ tone: "error", text: open });
              return;
            }
            // Signed out everywhere and anonymized: nothing of the account is left to show.
            window.location.replace("/");
          });
        }}
      >
        <TextInput
          label={t.settingsPage.currentPassword}
          name="currentPassword"
          type="password"
          required
          autoComplete="current-password"
        />
        <label className="flex items-start gap-3 text-sm text-ink">
          <input
            type="checkbox"
            checked={understood}
            onChange={(event) => setUnderstood(event.target.checked)}
          />
          {t.settingsPage.deactivateConfirm}
        </label>
        <button
          type="submit"
          disabled={!understood || pending}
          className="rounded-md bg-danger px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t.settingsPage.deactivateButton}
        </button>
      </form>
    </section>
  );
}
