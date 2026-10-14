"use client";

import { useSwitchLanguage, useT } from "../_lib/i18n";

/** Small presentational pieces shared by the dashboard screens (TASK-052). */

// Generic pieces live in src/app/_components/ui.tsx since TASK-058 (shared with the storefront).
export { Field, Notice, StatusPanel, submit, SubmitButton, TextLink } from "@/app/_components/ui";

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
