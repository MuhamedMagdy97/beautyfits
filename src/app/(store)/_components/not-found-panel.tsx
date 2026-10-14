"use client";

import { StatusPanel, TextLink } from "@/app/_components/ui";
import { useT } from "../_lib/i18n";

export function NotFoundPanel() {
  const t = useT();
  return (
    <main className="mx-auto w-full max-w-lg flex-1 p-8">
      <StatusPanel
        title="404"
        message={t.notFound}
        action={<TextLink href="/">{t.backHome}</TextLink>}
      />
    </main>
  );
}
