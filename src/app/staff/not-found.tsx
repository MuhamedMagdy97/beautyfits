"use client";

import Link from "next/link";
import { StatusPanel } from "./_components/ui";
import { useT } from "./_lib/i18n";

export default function StaffNotFound() {
  const t = useT();
  return (
    <div className="mx-auto w-full max-w-lg flex-1 p-8">
      <StatusPanel
        title="404"
        message={t.notFound}
        action={
          <Link href="/staff" className="text-sm text-plum underline-offset-4 hover:underline">
            {t.backToDashboard}
          </Link>
        }
      />
    </div>
  );
}
