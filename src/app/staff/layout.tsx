import type { Metadata } from "next";
import { Playfair_Display } from "next/font/google";
import { cookies } from "next/headers";
import { LangProvider } from "./_lib/i18n";
import { LANG_COOKIE, parseLang } from "./_lib/lang";

const playfair = Playfair_Display({ variable: "--font-display", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "BeautyFits Staff",
  robots: { index: false, follow: false },
};

/** Staff dashboard root (TASK-052): language, direction and brand surface. */
export default async function StaffLayout({ children }: LayoutProps<"/staff">) {
  const lang = parseLang((await cookies()).get(LANG_COOKIE)?.value);
  return (
    <div
      lang={lang}
      dir={lang === "ar" ? "rtl" : "ltr"}
      className={`${playfair.variable} flex min-h-screen flex-1 flex-col bg-velvet font-sans text-ink`}
    >
      <LangProvider lang={lang}>{children}</LangProvider>
    </div>
  );
}
