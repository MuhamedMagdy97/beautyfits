"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "../_lib/i18n";

/** Profile / Addresses / Wishlist switcher of the customer account. */
export function AccountNav() {
  const t = useT();
  const pathname = usePathname();
  const links = [
    { href: "/account", label: t.accountPage.profile },
    { href: "/account/addresses", label: t.accountPage.addresses },
    { href: "/wishlist", label: t.wishlistPage.title },
  ];
  return (
    <nav aria-label={t.account} className="mb-6 flex flex-wrap gap-2">
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          aria-current={pathname === link.href ? "page" : undefined}
          className={`rounded-full border px-4 py-1.5 text-sm ${
            pathname === link.href
              ? "border-plum bg-plum text-white"
              : "border-line bg-white text-ink hover:border-plum"
          }`}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
