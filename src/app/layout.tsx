import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import { parseLang, STORE_LANG_COOKIE } from "./(store)/_lib/lang";
import { FormValidation } from "./_components/form-validation";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "BeautyFits",
  description: "BeautyFits — beauty that fits you.",
};

/**
 * Root layout. The document language and direction follow the storefront
 * language (R14, TASK-058); the staff dashboard sets its own on its wrapper.
 */
export default async function RootLayout({ children }: LayoutProps<"/">) {
  const lang = parseLang((await cookies()).get(STORE_LANG_COOKIE)?.value);
  return (
    <html
      lang={lang}
      dir={lang === "ar" ? "rtl" : "ltr"}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <FormValidation />
      </body>
    </html>
  );
}
