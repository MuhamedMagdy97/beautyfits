"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { PermissionCode } from "@/server/modules/rbac/catalog";
import { staffApi } from "../_lib/api";
import { catalogError, useCatalogT } from "../_lib/catalog-i18n";
import { useStaffSession } from "../_lib/session";
import { Notice, StatusPanel } from "./ui";

/**
 * Building blocks of the catalog and inventory screens (TASK-053, ADR-0053).
 * Presentation and request plumbing only: the API decides and validates.
 */

/** Whether the session holds a permission (cosmetic; the API checks again). */
export function useCan(): (code: PermissionCode) => boolean {
  const { session } = useStaffSession();
  return (code) => session.permissions.includes(code);
}

/** Shows `children` only when one of the permissions is held, else access denied. */
export function Guard({
  anyOf,
  children,
}: {
  anyOf: readonly PermissionCode[];
  children: React.ReactNode;
}) {
  const { t } = useCatalogT();
  const can = useCan();
  if (!anyOf.some(can)) {
    return <StatusPanel title={t.accessDenied} />;
  }
  return children;
}

type Load<T> =
  { status: "loading" } | { status: "ready"; data: T } | { status: "error"; error: unknown };

/** GET `path` and keep the result; `reload` fetches it again. */
export function useApiData<T>(path: string): { state: Load<T>; reload: () => void } {
  const [state, setState] = useState<Load<T>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    staffApi<T>(path).then(
      (data) => active && setState({ status: "ready", data }),
      (error: unknown) => active && setState({ status: "error", error }),
    );
    return () => {
      active = false;
    };
  }, [path, attempt]);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, reload };
}

/** Renders loading and error states, else `children(data)`. */
export function Loaded<T>({
  load,
  reload,
  children,
}: {
  load: Load<T>;
  reload: () => void;
  children: (data: T) => React.ReactNode;
}) {
  const { t, c } = useCatalogT();
  if (load.status === "loading") {
    return (
      <p className="p-6 text-ink-soft" aria-busy>
        {t.loading}
      </p>
    );
  }
  if (load.status === "error") {
    return (
      <StatusPanel
        title={t.somethingWrong}
        message={catalogError(t, c, load.error)}
        action={<Button onClick={reload}>{t.retry}</Button>}
      />
    );
  }
  return children(load.data);
}

/**
 * Runs a change against the API: tracks pending, shows a localized error or
 * a saved notice, and calls `onDone` after success. `describe` replaces the
 * default error wording (screens with their own refusal reasons).
 */
export function useAction(onDone?: () => void, describe?: (error: unknown) => string) {
  const { t, c } = useCatalogT();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  async function run(action: () => Promise<unknown>, success: string = c.saved) {
    setPending(true);
    setMessage(null);
    try {
      await action();
      setMessage({ tone: "info", text: success });
      onDone?.();
      return true;
    } catch (error) {
      setMessage({ tone: "error", text: describe?.(error) ?? catalogError(t, c, error) });
      return false;
    } finally {
      setPending(false);
    }
  }
  const notice = message ? <Notice tone={message.tone}>{message.text}</Notice> : null;
  return { run, pending, notice, fail: (text: string) => setMessage({ tone: "error", text }) };
}

export function PageTitle({ children, aside }: { children: string; aside?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <h1 className="font-[family-name:var(--font-display)] text-3xl text-ink">{children}</h1>
      {aside}
    </div>
  );
}

/** Products / Brands / Categories switcher. */
export function CatalogTabs() {
  const { c } = useCatalogT();
  return (
    <Tabs
      label={c.products}
      tabs={[
        { href: "/staff/products", label: c.products },
        { href: "/staff/products/brands", label: c.brands },
        { href: "/staff/products/categories", label: c.categories },
      ]}
    />
  );
}

/** Links between the screens of one section; the current one is highlighted. */
export function Tabs({ label, tabs }: { label: string; tabs: { href: string; label: string }[] }) {
  const pathname = usePathname();
  return (
    <nav className="mb-6 flex flex-wrap gap-2 border-b border-line" aria-label={label}>
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={pathname === tab.href ? "page" : undefined}
          className={`-mb-px border-b-2 px-3 py-2 text-sm ${
            pathname === tab.href
              ? "border-plum font-semibold text-plum"
              : "border-transparent text-ink-soft hover:text-ink"
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

export function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="mb-6 rounded-xl border border-line bg-white p-5">
      {title ? (
        <h2 className="mb-4 font-[family-name:var(--font-display)] text-xl text-ink">{title}</h2>
      ) : null}
      {children}
    </section>
  );
}

export function Button({
  variant = "primary",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "plain" | "danger" }) {
  const look = {
    primary: "bg-plum text-white hover:bg-plum-soft",
    plain: "border border-line text-plum hover:bg-velvet-low",
    danger: "border border-danger text-danger hover:bg-danger-soft",
  }[variant];
  return (
    <button
      type="button"
      {...props}
      className={`rounded-md px-3 py-1.5 text-sm font-semibold disabled:opacity-50 ${look} ${props.className ?? ""}`}
    />
  );
}

const inputClass =
  "block w-full rounded-md border border-line bg-velvet-low px-3 py-2 text-sm text-ink outline-none focus:border-plum focus:ring-2 focus:ring-blush";

export function Input({
  label,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="block text-sm text-ink-soft">
      <span className="mb-1 block">{label}</span>
      <input {...props} className={inputClass} />
    </label>
  );
}

export function TextArea({
  label,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string }) {
  return (
    <label className="block text-sm text-ink-soft">
      <span className="mb-1 block">{label}</span>
      <textarea rows={3} {...props} className={inputClass} />
    </label>
  );
}

export function Select({
  label,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  return (
    <label className="block text-sm text-ink-soft">
      <span className="mb-1 block">{label}</span>
      <select {...props} className={inputClass}>
        {children}
      </select>
    </label>
  );
}

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const { c } = useCatalogT();
  const tone =
    status === "PUBLISHED" || status === "ACTIVE"
      ? "bg-velvet-low text-plum border-plum"
      : status === "ARCHIVED" || status === "INACTIVE"
        ? "bg-white text-ink-soft border-line"
        : "bg-blush/30 text-ink border-blush";
  return (
    <span className={`inline-block rounded-full border px-2 py-0.5 text-xs ${tone}`}>
      {label ?? c.statuses[status] ?? status}
    </span>
  );
}

/**
 * Previous / next paging. The API reports totals in `meta`, which the shared
 * client does not return, so "next" is offered while a page comes back full.
 */
// ponytail: an exact multiple of pageSize shows one empty last page; read meta.pagination if that matters.
export function Pager({
  page,
  count,
  pageSize,
  onPage,
}: {
  page: number;
  count: number;
  pageSize: number;
  onPage: (page: number) => void;
}) {
  const { c } = useCatalogT();
  if (page === 1 && count < pageSize) {
    return null;
  }
  return (
    <div className="mt-4 flex items-center gap-3 text-sm">
      <Button variant="plain" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        {c.previous}
      </Button>
      <span className="text-ink-soft">
        {c.page} {page}
      </span>
      <Button variant="plain" disabled={count < pageSize} onClick={() => onPage(page + 1)}>
        {c.next}
      </Button>
    </div>
  );
}

/** Table wrapper that scrolls sideways on small screens. */
export function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-white">
      <table className="w-full text-sm">
        <thead className="bg-velvet-low text-ink-soft">
          <tr>
            {head.map((label, index) => (
              <th key={index} className="px-3 py-2 text-start font-normal">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}

/** The name in the current language. */
export function useLocalName(): (item: { nameAr: string | null; nameEn: string | null }) => string {
  const { english } = useCatalogT();
  return (item) => (english ? item.nameEn : item.nameAr) ?? item.nameEn ?? item.nameAr ?? "";
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}
