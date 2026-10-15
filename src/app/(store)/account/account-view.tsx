"use client";

import { TextInput } from "../_components/address-form";
import {
  Button,
  CustomerOnly,
  Loaded,
  Page,
  PageTitle,
  useRun,
  useStoreData,
} from "../_components/shop";
import { storeSend } from "../_lib/api";
import { useT } from "../_lib/i18n";
import { useShopper } from "../_lib/session";
import { AccountNav } from "./account-nav";

interface Me {
  account: { email: string };
  customer: {
    fullName: string;
    phone: string;
    preferredLocale: "ar" | "en";
    dateOfBirth: string | null;
  };
}

/** Customer profile (API "TASK-009 Amendments"): name, language, date of birth. */
export function AccountView() {
  const t = useT();
  return (
    <Page>
      <PageTitle>{t.account}</PageTitle>
      <AccountNav />
      <CustomerOnly>
        <Profile />
      </CustomerOnly>
    </Page>
  );
}

function Profile() {
  const t = useT();
  const { reload: reloadShopper } = useShopper();
  const { state, reload, set } = useStoreData<Me>("/api/v1/me");
  const { run, pending, notice } = useRun();
  return (
    <Loaded load={state} reload={reload}>
      {(me) => (
        <form
          method="post"
          className="max-w-xl space-y-4 rounded-xl border border-line bg-white p-6"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const dateOfBirth = String(form.get("dateOfBirth") ?? "");
            void run(async () => {
              set(
                await storeSend<Me>("PATCH", "/api/v1/me", {
                  fullName: String(form.get("fullName") ?? "").trim(),
                  preferredLocale: form.get("preferredLocale"),
                  dateOfBirth: dateOfBirth || null,
                }),
              );
              reloadShopper();
            }, t.accountPage.saved);
          }}
        >
          {notice}
          <dl className="grid gap-2 text-sm sm:grid-cols-[140px_1fr]">
            <dt className="text-ink-soft">{t.email}</dt>
            <dd dir="ltr" className="text-start">
              {me.account.email}
            </dd>
            <dt className="text-ink-soft">{t.phone}</dt>
            <dd dir="ltr" className="text-start">
              {me.customer.phone}
            </dd>
          </dl>
          <TextInput
            label={t.fullName}
            name="fullName"
            required
            autoComplete="name"
            defaultValue={me.customer.fullName}
          />
          <label className="block text-sm text-ink-soft">
            <span className="mb-1 block">{t.accountPage.language}</span>
            <select
              name="preferredLocale"
              defaultValue={me.customer.preferredLocale}
              className="block w-full rounded-md border border-line bg-velvet-low px-3 py-2 text-base text-ink"
            >
              <option value="ar">العربية</option>
              <option value="en">English</option>
            </select>
          </label>
          <TextInput
            label={t.accountPage.dateOfBirth}
            name="dateOfBirth"
            type="date"
            defaultValue={me.customer.dateOfBirth ?? ""}
          />
          <Button type="submit" variant="primary" disabled={pending}>
            {t.accountPage.save}
          </Button>
        </form>
      )}
    </Loaded>
  );
}
