import { Playfair_Display } from "next/font/google";
import { cookies } from "next/headers";
import { StoreFooter, StoreHeader } from "./_components/shell";
import { LangProvider } from "./_lib/i18n";
import { parseLang, STORE_LANG_COOKIE } from "./_lib/lang";
import { ShopperProvider } from "./_lib/session";

const playfair = Playfair_Display({ variable: "--font-display", subsets: ["latin"] });

/** Storefront shell (TASK-058): language, shopper session, header and footer. */
export default async function StoreLayout({ children }: { children: React.ReactNode }) {
  const lang = parseLang((await cookies()).get(STORE_LANG_COOKIE)?.value);
  return (
    <div className={`${playfair.variable} flex min-h-screen flex-1 flex-col bg-velvet text-ink`}>
      <LangProvider lang={lang}>
        <ShopperProvider>
          <StoreHeader />
          <div className="flex flex-1 flex-col">{children}</div>
          <StoreFooter />
        </ShopperProvider>
      </LangProvider>
    </div>
  );
}
