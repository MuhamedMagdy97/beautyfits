"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BrandMark, LanguageButton, StatusPanel } from "../_components/ui";
import { errorMessage, useT } from "../_lib/i18n";
import { visibleNav } from "../_lib/navigation";
import { StaffSessionProvider, useStaffSession } from "../_lib/session";

/** Signed-in dashboard shell (TASK-052): session, permission-aware navigation, header. */
export default function ShellLayout({ children }: { children: React.ReactNode }) {
  const t = useT();
  return (
    <StaffSessionProvider
      renderLoading={() => (
        <main className="flex flex-1 items-center justify-center p-8 text-ink-soft" aria-busy>
          {t.loading}
        </main>
      )}
      renderError={(error, retry) => (
        <main className="mx-auto w-full max-w-lg flex-1 p-8">
          <StatusPanel
            title={t.somethingWrong}
            message={errorMessage(t, error)}
            action={<ActionButton onClick={retry}>{t.retry}</ActionButton>}
          />
        </main>
      )}
    >
      <Shell>{children}</Shell>
    </StaffSessionProvider>
  );
}

function ActionButton({ onClick, children }: { onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md bg-plum px-4 py-2 text-sm font-semibold text-white hover:bg-plum-soft"
    >
      {children}
    </button>
  );
}

function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const active = href === "/staff" ? pathname === href : pathname.startsWith(href);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`block rounded-md px-3 py-2 text-sm ${
        active ? "bg-plum text-white" : "text-ink hover:bg-velvet-low"
      }`}
    >
      {label}
    </Link>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const t = useT();
  const { session, signOut } = useStaffSession();
  const nav = visibleNav(session.permissions);
  const level = t.levels[session.employee.level as keyof typeof t.levels] ?? session.employee.level;

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-line bg-white px-4 py-3 md:px-8">
        <BrandMark />
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span>
            <span className="font-semibold">{session.employee.displayName}</span>
            <span className="text-ink-soft"> · {level}</span>
          </span>
          <LanguageButton />
          <button
            type="button"
            onClick={() => void signOut()}
            className="rounded-md border border-line px-3 py-1 text-plum hover:bg-velvet-low"
          >
            {t.signOut}
          </button>
          <button
            type="button"
            onClick={() => void signOut(true)}
            className="text-ink-soft underline-offset-4 hover:underline"
          >
            {t.signOutEverywhere}
          </button>
        </div>
      </header>
      <div className="flex flex-1 flex-col gap-6 p-4 md:flex-row md:p-8">
        <nav aria-label={t.staffDashboard} className="md:w-60 md:shrink-0">
          <div className="rounded-xl border border-line bg-white p-3">
            <NavLink href="/staff" label={t.sections.overview} />
            {nav.map((group) => (
              <div key={group.id} className="mt-4">
                <p className="px-3 pb-1 text-xs tracking-wider text-ink-soft uppercase">
                  {t.groups[group.id as keyof typeof t.groups]}
                </p>
                {group.sections.map((section) => (
                  <NavLink
                    key={section.slug}
                    href={`/staff/${section.slug}`}
                    label={t.sections[section.slug] ?? section.slug}
                  />
                ))}
              </div>
            ))}
          </div>
        </nav>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
