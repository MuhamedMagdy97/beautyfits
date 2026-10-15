"use client";

import { useState } from "react";
import { AddressFields, addressFromForm, addressLine } from "../../_components/address-form";
import {
  Button,
  CustomerOnly,
  Loaded,
  Page,
  PageTitle,
  useRun,
  useStoreData,
} from "../../_components/shop";
import { storeSend } from "../../_lib/api";
import { useT } from "../../_lib/i18n";
import type { Address } from "../../_lib/types";
import { AccountNav } from "../account-nav";

/** Saved addresses (API §11, Q45): add, edit, remove, choose the default. */
export function AddressBook() {
  const t = useT();
  return (
    <Page>
      <PageTitle>{t.accountPage.addresses}</PageTitle>
      <AccountNav />
      <CustomerOnly>
        <Addresses />
      </CustomerOnly>
    </Page>
  );
}

function Addresses() {
  const t = useT();
  const { state, reload } = useStoreData<Address[]>("/api/v1/me/addresses");
  const [editing, setEditing] = useState<string | null>(null);
  const { run, pending, notice } = useRun();

  const act = (action: () => Promise<unknown>, success?: string) =>
    void run(async () => {
      await action();
      setEditing(null);
      reload();
    }, success);

  return (
    <Loaded load={state} reload={reload}>
      {(addresses) => (
        <div className="max-w-3xl space-y-4">
          {notice}
          {addresses.length === 0 && editing !== "new" ? (
            <p className="text-ink-soft">{t.accountPage.noAddresses}</p>
          ) : null}
          {addresses.map((address) =>
            editing === address.id ? (
              <AddressEditor
                key={address.id}
                initial={address}
                pending={pending}
                onCancel={() => setEditing(null)}
                onSave={(body) =>
                  act(
                    () => storeSend("PATCH", `/api/v1/me/addresses/${address.id}`, body),
                    t.accountPage.saved,
                  )
                }
              />
            ) : (
              <div
                key={address.id}
                className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-line bg-white p-5"
              >
                <div className="text-sm">
                  <p className="text-ink">
                    {address.label ? `${address.label} — ` : ""}
                    {address.recipientName}
                    {address.isDefault ? (
                      <span className="ms-2 rounded bg-velvet-low px-2 py-0.5 text-xs text-plum">
                        {t.accountPage.default}
                      </span>
                    ) : null}
                  </p>
                  <p className="text-ink-soft">{addressLine(address)}</p>
                  <p className="text-ink-soft" dir="ltr">
                    {address.phone}
                  </p>
                  {!address.area.active ? (
                    <p className="text-danger">{t.accountPage.areaInactive}</p>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-3">
                  {!address.isDefault ? (
                    <Button
                      variant="link"
                      disabled={pending}
                      onClick={() =>
                        act(() =>
                          storeSend("POST", `/api/v1/me/addresses/${address.id}/set-default`),
                        )
                      }
                    >
                      {t.accountPage.makeDefault}
                    </Button>
                  ) : null}
                  <Button variant="link" onClick={() => setEditing(address.id)}>
                    {t.accountPage.edit}
                  </Button>
                  <Button
                    variant="link"
                    disabled={pending}
                    onClick={() => {
                      if (window.confirm(t.accountPage.confirmRemove)) {
                        act(() => storeSend("DELETE", `/api/v1/me/addresses/${address.id}`));
                      }
                    }}
                  >
                    {t.cartPage.remove}
                  </Button>
                </div>
              </div>
            ),
          )}
          {editing === "new" ? (
            <AddressEditor
              pending={pending}
              onCancel={() => setEditing(null)}
              onSave={(body) =>
                act(() => storeSend("POST", "/api/v1/me/addresses", body), t.accountPage.saved)
              }
            />
          ) : (
            <Button variant="primary" onClick={() => setEditing("new")}>
              {t.accountPage.addAddress}
            </Button>
          )}
        </div>
      )}
    </Loaded>
  );
}

function AddressEditor({
  initial,
  pending,
  onSave,
  onCancel,
}: {
  initial?: Address;
  pending: boolean;
  onSave: (body: Record<string, string>) => void;
  onCancel: () => void;
}) {
  const t = useT();
  return (
    <form
      method="post"
      className="space-y-4 rounded-xl border border-plum bg-white p-5"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(addressFromForm(new FormData(event.currentTarget), true));
      }}
    >
      <AddressFields initial={initial} withLabel />
      <div className="flex gap-3">
        <Button type="submit" variant="primary" disabled={pending}>
          {t.accountPage.save}
        </Button>
        <Button onClick={onCancel}>{t.accountPage.cancel}</Button>
      </div>
    </form>
  );
}
