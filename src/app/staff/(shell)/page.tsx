"use client";

import Link from "next/link";
import { useT } from "../_lib/i18n";
import { visibleNav } from "../_lib/navigation";
import { useStaffSession } from "../_lib/session";

/** Dashboard home: the sections this employee may open. */
export default function OverviewPage() {
  const t = useT();
  const { session } = useStaffSession();
  const sections = visibleNav(session.permissions).flatMap((group) => group.sections);

  return (
    <section>
      <h1 className="font-[family-name:var(--font-display)] text-3xl text-ink">
        {t.welcome}, {session.employee.displayName}
      </h1>
      <p className="mt-2 text-ink-soft">{sections.length > 0 ? t.overviewIntro : t.noSections}</p>
      <ul className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {sections.map((section) => (
          <li key={section.slug}>
            <Link
              href={`/staff/${section.slug}`}
              className="block rounded-xl border border-line bg-white p-5 text-ink hover:border-plum"
            >
              {t.sections[section.slug] ?? section.slug}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
