"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "../_lib/i18n";

/** Switcher between the customer account screens (TASK-059, TASK-060). */
export function AccountNav() {
  const t = useT();
  const pathname = usePathname();
  const links = [
    { href: "/account", label: t.accountPage.profile },
    { href: "/account/orders", label: t.my.orders },
    { href: "/account/returns", label: t.my.returns },
    { href: "/account/wallet", label: t.my.wallet },
    { href: "/account/notifications", label: t.my.notifications },
    { href: "/account/addresses", label: t.accountPage.addresses },
    { href: "/wishlist", label: t.wishlistPage.title },
    { href: "/account/settings", label: t.my.settings },
  ];
  return (
    <nav aria-label={t.account} className="mb-6 flex flex-wrap gap-2">
      {links.map((link) => {
        const current =
          pathname === link.href ||
          (link.href !== "/account" && pathname.startsWith(`${link.href}/`));
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={current ? "page" : undefined}
            className={`rounded-full border px-4 py-1.5 text-sm ${
              current
                ? "border-plum bg-plum text-white"
                : "border-line bg-white text-ink hover:border-plum"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
