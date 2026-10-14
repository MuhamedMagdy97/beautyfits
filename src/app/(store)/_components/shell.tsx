"use client";

import Link from "next/link";
import { useShopper } from "../_lib/session";
import { useSwitchLanguage, useT } from "../_lib/i18n";

/**
 * Storefront header and footer (TASK-058), after the Stitch homepage header
 * (design-reference/google-stitch/beautyfits_luxury_beauty_homepage). The
 * category navigation and search arrive with the catalog screens (TASK-059).
 */

export function BrandLink() {
  const t = useT();
  return (
    <Link href="/" className="group flex flex-col leading-tight">
      <span className="font-[family-name:var(--font-display)] text-2xl tracking-wider text-plum uppercase group-hover:text-plum-soft">
        {t.brand}
      </span>
      <span className="text-[10px] tracking-[0.2em] text-ink-soft uppercase">{t.tagline}</span>
    </Link>
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

function BagIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor">
      <path strokeWidth="1.5" d="M5 8h14l-1 12H6L5 8Zm4 0V6a3 3 0 0 1 6 0v2" />
    </svg>
  );
}

function AccountArea() {
  const t = useT();
  const { shopper, signOut } = useShopper();
  if (shopper.status === "loading") {
    return <span className="text-sm text-ink-soft" aria-busy />;
  }
  if (shopper.status === "guest") {
    return (
      <Link href="/login" className="text-sm text-ink hover:text-plum">
        {t.signIn}
      </Link>
    );
  }
  return (
    <details className="relative">
      <summary className="cursor-pointer list-none text-sm text-ink hover:text-plum">
        {t.hello.replace("{name}", shopper.session.customer.fullName)}
      </summary>
      <div className="absolute end-0 z-10 mt-2 w-56 rounded-md border border-line bg-white p-2 shadow-sm">
        <button
          type="button"
          onClick={() => void signOut()}
          className="block w-full rounded px-3 py-2 text-start text-sm hover:bg-velvet-low"
        >
          {t.signOut}
        </button>
        <button
          type="button"
          onClick={() => void signOut(true)}
          className="block w-full rounded px-3 py-2 text-start text-sm text-ink-soft hover:bg-velvet-low"
        >
          {t.signOutEverywhere}
        </button>
      </div>
    </details>
  );
}

export function StoreHeader() {
  const t = useT();
  const { cartCount } = useShopper();
  return (
    <header className="border-b border-line bg-velvet">
      <div className="mx-auto flex h-20 max-w-[1360px] items-center justify-between gap-4 px-4 md:px-8">
        <BrandLink />
        <nav aria-label={t.mainNav} className="flex items-center gap-4">
          <LanguageButton />
          <AccountArea />
          <Link
            href="/cart"
            aria-label={t.cartItems.replace("{n}", String(cartCount))}
            className="relative p-2 text-ink hover:text-plum"
          >
            <BagIcon />
            <span className="absolute end-0 top-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-plum px-1 text-[10px] font-bold text-white">
              {cartCount}
            </span>
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function StoreFooter() {
  const t = useT();
  return (
    <footer className="mt-auto bg-ink text-velvet">
      <div className="mx-auto flex max-w-[1360px] flex-wrap items-center justify-between gap-4 px-4 py-8 text-sm md:px-8">
        <div>
          <p className="font-[family-name:var(--font-display)] text-lg tracking-wider uppercase">
            {t.brand}
          </p>
          <p className="text-xs tracking-[0.2em] uppercase opacity-70">{t.tagline}</p>
        </div>
        <p className="opacity-70">© {new Date().getFullYear()} BeautyFits</p>
      </div>
    </footer>
  );
}
