"use client";

import Link from "next/link";
import { notFound, useParams } from "next/navigation";
import { StatusPanel } from "../../_components/ui";
import { useT } from "../../_lib/i18n";
import { canSee, findSection } from "../../_lib/navigation";
import { useStaffSession } from "../../_lib/session";

/**
 * Placeholder for a dashboard section whose screen is not built yet
 * (TASK-053..057 add real routes, which take precedence over this one).
 * It also shows the access-denied state for sections the employee's roles
 * do not allow.
 */
export default function SectionPage() {
  const t = useT();
  const { session } = useStaffSession();
  const { section: slug } = useParams<{ section: string }>();
  const section = findSection(slug);
  if (!section) {
    notFound();
  }
  return (
    <StatusPanel
      title={t.sections[section.slug] ?? section.slug}
      message={canSee(section, session.permissions) ? t.sectionSoon : t.accessDenied}
      action={
        <Link href="/staff" className="text-sm text-plum underline-offset-4 hover:underline">
          {t.backToDashboard}
        </Link>
      }
    />
  );
}
