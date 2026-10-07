"use client";

import Link from "next/link";
import { useSwitchLanguage, useT } from "../_lib/i18n";

/** Small presentational pieces shared by the dashboard screens (TASK-052). */

export function BrandMark() {
  const t = useT();
  return (
    <div>
      <p className="font-[family-name:var(--font-display)] text-xl font-semibold tracking-wide text-plum uppercase">
        {t.brand}
      </p>
      <p className="text-xs text-ink-soft">{t.staffDashboard}</p>
    </div>
  );
}

export function LanguageButton() {
  const t = useT();
  const switchLanguage = useSwitchLanguage();
  return (
    <button
      type="button"
      onClick={switchLanguage}
      className="rounded-md px-2 py-1 text-sm text-plum underline-offset-4 hover:underline"
    >
      {t.switchLanguage}
    </button>
  );
}

/** Centered card for the signed-out pages. */
export function AuthCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-xl border border-line bg-white p-8 shadow-sm">
        <div className="mb-6 flex items-start justify-between gap-4">
          <BrandMark />
          <LanguageButton />
        </div>
        <h1 className="mb-6 font-[family-name:var(--font-display)] text-2xl text-ink">{title}</h1>
        {children}
      </div>
    </main>
  );
}

export function Field(props: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const { label, ...input } = props;
  return (
    <label className="mb-4 block text-sm text-ink-soft">
      <span className="mb-1 block">{label}</span>
      <input
        {...input}
        required
        className="block w-full rounded-md border border-line bg-velvet-low px-3 py-2 text-base text-ink outline-none focus:border-plum focus:ring-2 focus:ring-blush"
      />
    </label>
  );
}

export function SubmitButton({ pending, children }: { pending: boolean; children: string }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-md bg-plum px-4 py-2.5 text-sm font-semibold tracking-wide text-white uppercase transition-colors hover:bg-plum-soft disabled:opacity-60"
    >
      {children}
    </button>
  );
}

export function Notice({ tone, children }: { tone: "info" | "error"; children: React.ReactNode }) {
  if (!children) {
    return null;
  }
  const colors =
    tone === "error"
      ? "bg-danger-soft text-danger"
      : "bg-velvet-low text-ink-soft border border-line";
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={`mb-4 rounded-md px-3 py-2 text-sm ${colors}`}
    >
      {children}
    </p>
  );
}

export function TextLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="text-sm text-plum underline-offset-4 hover:underline">
      {children}
    </Link>
  );
}

/** Full-area message for loading, empty, denied, missing and error states. */
export function StatusPanel({
  title,
  message,
  action,
}: {
  title: string;
  message?: string;
  action?: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-line bg-white p-8 text-center">
      <h1 className="font-[family-name:var(--font-display)] text-2xl text-ink">{title}</h1>
      {message ? <p className="mt-2 text-ink-soft">{message}</p> : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </section>
  );
}

/** onSubmit handler that keeps the typed values (no form reset) and passes FormData. */
export function submit(handler: (form: FormData) => void) {
  return (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    handler(new FormData(event.currentTarget));
  };
}
