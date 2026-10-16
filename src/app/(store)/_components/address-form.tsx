"use client";

import { useState } from "react";
import { useT } from "../_lib/i18n";
import type { Address, Governorate } from "../_lib/types";
import { useStoreData } from "./shop";

/**
 * Delivery address inputs (API "TASK-009 Amendments", R32): governorate and
 * area come from the managed location list; the API validates everything.
 */

export const ADDRESS_FIELDS = [
  "recipientName",
  "phone",
  "areaId",
  "city",
  "street",
  "building",
  "floor",
  "apartment",
  "landmark",
  "notes",
] as const;

/** The address fields of a form (a blank optional field means none, API §11). */
export function addressFromForm(form: FormData, withLabel = false): Record<string, string> {
  const names = withLabel ? [...ADDRESS_FIELDS, "label"] : ADDRESS_FIELDS;
  return Object.fromEntries(names.map((name) => [name, String(form.get(name) ?? "").trim()]));
}

export function TextInput({
  label,
  required = false,
  ...input
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="block text-sm text-ink-soft">
      <span className="mb-1 block">
        {label}
        {required ? " *" : ""}
      </span>
      <input
        {...input}
        required={required}
        className="block w-full rounded-md border border-line bg-velvet-low px-3 py-2 text-base text-ink outline-none focus:border-plum focus:ring-2 focus:ring-blush"
      />
    </label>
  );
}

const selectClass =
  "block w-full rounded-md border border-line bg-velvet-low px-3 py-2 text-base text-ink focus:border-plum";

export function AddressFields({
  initial,
  withLabel = false,
}: {
  initial?: Address;
  withLabel?: boolean;
}) {
  const t = useT();
  const { state } = useStoreData<Governorate[]>("/api/v1/locations");
  const [governorateId, setGovernorateId] = useState(initial?.governorate.id ?? "");
  const governorates = state.status === "ready" ? state.data : [];
  const areas = governorates.find((g) => g.id === governorateId)?.areas ?? [];

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {withLabel ? (
        <TextInput
          label={t.address.label}
          name="label"
          maxLength={50}
          defaultValue={initial?.label ?? ""}
        />
      ) : null}
      <TextInput
        label={t.address.recipientName}
        name="recipientName"
        required
        autoComplete="name"
        defaultValue={initial?.recipientName}
      />
      <TextInput
        label={t.phone}
        name="phone"
        required
        type="tel"
        autoComplete="tel"
        dir="ltr"
        placeholder="01xxxxxxxxx"
        defaultValue={initial?.phone}
      />
      <label className="block text-sm text-ink-soft">
        <span className="mb-1 block">{t.address.governorate} *</span>
        <select
          required
          value={governorateId}
          onChange={(event) => setGovernorateId(event.target.value)}
          className={selectClass}
        >
          <option value="">{t.address.choose}</option>
          {governorates.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm text-ink-soft">
        <span className="mb-1 block">{t.address.area} *</span>
        <select
          name="areaId"
          required
          key={governorateId}
          disabled={governorateId === "" || areas.length === 0}
          defaultValue={initial?.governorate.id === governorateId ? initial.area.id : ""}
          className={`${selectClass} disabled:opacity-60`}
        >
          <option value="">
            {governorateId === "" ? t.address.chooseGovernorateFirst : t.address.choose}
          </option>
          {areas.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        {governorateId !== "" && state.status === "ready" && areas.length === 0 ? (
          <span role="status" className="mt-1.5 block text-xs text-danger">
            {t.address.noAreas}
          </span>
        ) : null}
      </label>
      <TextInput label={t.address.city} name="city" defaultValue={initial?.city ?? ""} />
      <TextInput
        label={t.address.street}
        name="street"
        required
        autoComplete="street-address"
        defaultValue={initial?.street}
      />
      <TextInput
        label={t.address.building}
        name="building"
        defaultValue={initial?.building ?? ""}
      />
      <TextInput label={t.address.floor} name="floor" defaultValue={initial?.floor ?? ""} />
      <TextInput
        label={t.address.apartment}
        name="apartment"
        defaultValue={initial?.apartment ?? ""}
      />
      <TextInput
        label={t.address.landmark}
        name="landmark"
        defaultValue={initial?.landmark ?? ""}
      />
      <TextInput label={t.address.notes} name="notes" defaultValue={initial?.notes ?? ""} />
    </div>
  );
}

/** One line of an address for lists and the checkout choice. */
export function addressLine(address: Address): string {
  return [
    address.street,
    address.building,
    address.area.name,
    address.city,
    address.governorate.name,
  ]
    .filter(Boolean)
    .join(" · ");
}
