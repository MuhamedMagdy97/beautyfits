"use client";

import Link from "next/link";
import { ProductCard, useStoreData } from "./_components/shop";
import type { Pagination } from "./_lib/api";
import { categoryHref, topCategories } from "./_lib/home";
import { useT } from "./_lib/i18n";
import type { Category, ProductSummary } from "./_lib/types";

/**
 * Home page (TASK-059B) after the Stitch homepage
 * (design-reference/google-stitch/beautyfits_luxury_beauty_homepage).
 * Catalog sections come from the public API; artwork is placeholder until
 * the owner supplies BeautyFits images (see the task's Open Items).
 */

const FRAGRANCE = /fragrance|perfume|parfum|scent/i;
const MAKEUP = /make-?up/i;

const display = "font-[family-name:var(--font-display)]";
const primaryLink =
  "inline-flex items-center justify-center rounded-md bg-plum px-7 py-3 text-sm font-semibold tracking-wide text-white uppercase transition-colors hover:bg-plum-soft";

/** Decorative stand-in for campaign photography; tone picks the gradient. */
function Artwork({ tone, className = "" }: { tone: number; className?: string }) {
  const tones = [
    "from-[#6b1e3f] via-[#c98a9b] to-[#f6eee8]",
    "from-[#503708] via-[#c9a46c] to-[#fff7fb]",
    "from-[#f9f2f6] via-[#feb9cb] to-[#844e5e]",
    "from-[#ffd9e3] via-[#e8c086] to-[#6b1e3f]",
  ];
  return (
    <div aria-hidden className={`bg-linear-to-br ${tones[tone % tones.length]} ${className}`}>
      <div className="flex h-full w-full items-center justify-center">
        <span className={`${display} text-6xl text-white/40 select-none`}>BF</span>
      </div>
    </div>
  );
}

function Eyebrow({ children }: { children: string }) {
  return (
    <span className="text-[11px] font-semibold tracking-[0.2em] text-[#844e5e] uppercase">
      {children}
    </span>
  );
}

function SectionHead({
  eyebrow,
  title,
  intro,
  link,
}: {
  eyebrow: string;
  title: string;
  intro: string;
  link?: { href: string; label: string };
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <Eyebrow>{eyebrow}</Eyebrow>
        <h2 className={`${display} mt-2 text-3xl text-ink md:text-4xl`}>{title}</h2>
        <p className="mt-2 text-ink-soft">{intro}</p>
      </div>
      {link ? (
        <Link
          href={link.href}
          className="text-sm font-semibold text-plum underline-offset-4 hover:underline"
        >
          {link.label}
        </Link>
      ) : null}
    </div>
  );
}

function Icon({ d }: { d: string }) {
  return (
    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-velvet-low text-plum">
      <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor">
        <path strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" d={d} />
      </svg>
    </span>
  );
}

function TrustBar() {
  const t = useT().homePage;
  const items = [
    { title: t.trustCod, text: t.trustCodText, d: "M3 7h18v10H3zM12 12h.01M7 12h.01M17 12h.01" },
    { title: t.trustReturns, text: t.trustReturnsText, d: "M4 12a8 8 0 1 0 3-6.2M4 4v4h4" },
    {
      title: t.trustGuest,
      text: t.trustGuestText,
      d: "M5 8h14l-1 12H6L5 8Zm4 0V6a3 3 0 0 1 6 0v2",
    },
    {
      title: t.trustReviews,
      text: t.trustReviewsText,
      d: "m12 4 2.5 5 5.5.8-4 3.9.9 5.5-4.9-2.6-4.9 2.6.9-5.5-4-3.9 5.5-.8z",
    },
  ];
  return (
    <section aria-label={t.trust} className="border-y border-line bg-white">
      <ul className="mx-auto grid max-w-[1360px] grid-cols-1 gap-6 px-4 py-8 sm:grid-cols-2 md:px-8 lg:grid-cols-4">
        {items.map((item) => (
          <li key={item.title} className="flex items-start gap-3">
            <Icon d={item.d} />
            <div>
              <p className="font-semibold text-ink">{item.title}</p>
              <p className="text-sm text-ink-soft">{item.text}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function CategoryTiles({ categories }: { categories: Category[] }) {
  const t = useT().homePage;
  const tiles = topCategories(categories);
  if (tiles.length === 0) {
    return null;
  }
  return (
    <section className="mx-auto w-full max-w-[1360px] px-4 py-16 md:px-8">
      <SectionHead
        eyebrow={t.categoriesEyebrow}
        title={t.categoriesTitle}
        intro={t.categoriesIntro}
        link={{ href: "/products", label: t.allCategories }}
      />
      <ul className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {tiles.map((category, i) => (
          <li key={category.id}>
            <Link
              href={`/products?categoryId=${category.id}`}
              className="group relative block aspect-[4/5] overflow-hidden rounded-xl"
            >
              <Artwork
                tone={i}
                className="h-full w-full transition-transform duration-500 group-hover:scale-105"
              />
              <span className="absolute inset-x-0 bottom-0 bg-linear-to-t from-black/60 to-transparent p-4 pt-12">
                <span className={`${display} text-xl text-white md:text-2xl`}>{category.name}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Editorial({
  eyebrow,
  titleStart,
  titleEnd,
  text,
  link,
  tone,
  flip,
}: {
  eyebrow: string;
  titleStart: string;
  titleEnd: string;
  text: string;
  link: { href: string; label: string };
  tone: number;
  flip?: boolean;
}) {
  return (
    <section className="mx-auto grid w-full max-w-[1360px] items-center gap-8 px-4 py-12 md:grid-cols-2 md:gap-16 md:px-8">
      <Artwork
        tone={tone}
        className={`aspect-[4/3] rounded-xl shadow-sm ${flip ? "md:order-last" : ""}`}
      />
      <div>
        <Eyebrow>{eyebrow}</Eyebrow>
        <h2 className={`${display} mt-3 text-3xl leading-tight text-ink md:text-5xl`}>
          {titleStart} <em className="text-plum">{titleEnd}</em>
        </h2>
        <p className="mt-4 max-w-lg text-lg text-ink-soft">{text}</p>
        <Link href={link.href} className={`${primaryLink} mt-8`}>
          {link.label}
        </Link>
      </div>
    </section>
  );
}

export default function HomePage() {
  const t = useT();
  const h = t.homePage;
  const { state: products } = useStoreData<{ data: ProductSummary[]; pagination: Pagination }>(
    "/api/v1/products?pageSize=8",
    true,
  );
  const { state: categoryState } = useStoreData<Category[]>("/api/v1/categories");
  const categories = categoryState.status === "ready" ? categoryState.data : [];
  const perfumes = categoryHref(categories, FRAGRANCE);
  const makeup = categoryHref(categories, MAKEUP);

  return (
    <main className="flex-1">
      <section className="mx-auto grid w-full max-w-[1360px] items-center gap-10 px-4 py-12 md:px-8 lg:grid-cols-12 lg:py-20">
        <div className="lg:col-span-5">
          <Eyebrow>{h.eyebrow}</Eyebrow>
          <h1 className={`${display} mt-4 text-4xl leading-tight text-ink md:text-6xl`}>
            {h.titleStart} <em className="text-plum">{h.titleEnd}</em>
          </h1>
          <p className="mt-6 max-w-md text-lg text-ink-soft">{h.intro}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/products" className={primaryLink}>
              {t.shop.shopNow}
            </Link>
            <Link
              href={perfumes}
              className="inline-flex items-center justify-center rounded-md border border-plum px-7 py-3 text-sm font-semibold tracking-wide text-plum uppercase transition-colors hover:bg-velvet-low"
            >
              {h.explorePerfumes}
            </Link>
          </div>
        </div>
        <Artwork tone={0} className="h-72 rounded-2xl shadow-sm md:h-[480px] lg:col-span-7" />
      </section>

      <TrustBar />

      <CategoryTiles categories={categories} />

      {products.status === "ready" && products.data.data.length > 0 ? (
        <section className="mx-auto w-full max-w-[1360px] px-4 py-12 md:px-8">
          <SectionHead
            eyebrow={h.newEyebrow}
            title={h.newTitle}
            intro={h.newIntro}
            link={{ href: "/products", label: h.viewAll }}
          />
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {products.data.data.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        </section>
      ) : null}

      <div className="bg-velvet-low py-8">
        <Editorial
          eyebrow={h.scentEyebrow}
          titleStart={h.scentTitleStart}
          titleEnd={h.scentTitleEnd}
          text={h.scentText}
          link={{ href: perfumes, label: h.shopPerfumes }}
          tone={1}
        />
        <Editorial
          eyebrow={h.makeupEyebrow}
          titleStart={h.makeupTitleStart}
          titleEnd={h.makeupTitleEnd}
          text={h.makeupText}
          link={{ href: makeup, label: h.exploreMakeup }}
          tone={2}
          flip
        />
      </div>
    </main>
  );
}
