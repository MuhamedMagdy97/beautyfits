import { cookies } from "next/headers";
import { NotFoundPanel } from "./(store)/_components/not-found-panel";
import { LangProvider } from "./(store)/_lib/i18n";
import { parseLang, STORE_LANG_COOKIE } from "./(store)/_lib/lang";

/** 404 for unmatched URLs and storefront `notFound()` (TASK-058). */
export default async function NotFound() {
  const lang = parseLang((await cookies()).get(STORE_LANG_COOKIE)?.value);
  return (
    <div className="flex flex-1 flex-col bg-velvet text-ink">
      <LangProvider lang={lang}>
        <NotFoundPanel />
      </LangProvider>
    </div>
  );
}
