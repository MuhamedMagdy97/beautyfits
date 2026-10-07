"use client";

import { StatusPanel } from "./_components/ui";
import { useT } from "./_lib/i18n";

/** Error boundary of the staff dashboard. No error details are shown to the user. */
export default function StaffError({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const t = useT();
  return (
    <main className="mx-auto w-full max-w-lg flex-1 p-8">
      <StatusPanel
        title={t.somethingWrong}
        message={t.errors.default}
        action={
          <button
            type="button"
            onClick={() => retry()}
            className="rounded-md bg-plum px-4 py-2 text-sm font-semibold text-white hover:bg-plum-soft"
          >
            {t.retry}
          </button>
        }
      />
    </main>
  );
}
