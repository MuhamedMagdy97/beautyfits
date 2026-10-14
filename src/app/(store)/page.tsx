"use client";

import { useT } from "./_lib/i18n";

/** Home page placeholder (TASK-058). Catalog sections arrive with TASK-059. */
export default function HomePage() {
  const t = useT();
  return (
    <main className="mx-auto w-full max-w-[1360px] flex-1 px-4 py-20 md:px-8">
      <h1 className="font-[family-name:var(--font-display)] text-4xl text-plum md:text-6xl">
        {t.homeTitle}
      </h1>
      <p className="mt-4 max-w-xl text-lg text-ink-soft">{t.homeIntro}</p>
    </main>
  );
}
