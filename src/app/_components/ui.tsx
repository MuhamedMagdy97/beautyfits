"use client";

import Link from "next/link";

/**
 * Brand-styled building blocks shared by the storefront and the staff
 * dashboard (TASK-052, moved here by TASK-058). Texts come from the caller.
 */

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
