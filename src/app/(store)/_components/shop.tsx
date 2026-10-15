"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Notice, StatusPanel } from "@/app/_components/ui";
import { redirectToLogin, storeApi, storePage } from "../_lib/api";
import { formatMoney } from "../_lib/format";
import { errorMessage, useLang, useT } from "../_lib/i18n";
import { useShopper } from "../_lib/session";
import type { ProductSummary } from "../_lib/types";

/**
 * Building blocks of the shopping screens (TASK-059). Presentation and
 * request plumbing only: the API decides prices, stock and totals.
 */

type Load<T> =
  { status: "loading" } | { status: "ready"; data: T } | { status: "error"; error: unknown };

/**
 * GET `path` (null: wait) and keep the result; `reload` fetches it again.
 * With `list`, the result is `{ data, pagination }` (`storePage`).
 */
export function useStoreData<T>(
  path: string | null,
  list = false,
): {
  state: Load<T>;
  reload: () => void;
  set: (data: T) => void;
} {
  const [state, setState] = useState<Load<T>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (path === null) {
      return;
    }
    let active = true;
    (list ? (storePage(path) as Promise<T>) : storeApi<T>(path)).then(
      (data) => active && setState({ status: "ready", data }),
      (error: unknown) => active && setState({ status: "error", error }),
    );
    return () => {
      active = false;
    };
  }, [path, list, attempt]);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  const set = useCallback((data: T) => setState({ status: "ready", data }), []);
  return { state, reload, set };
}

/** Loading and error states, else `children(data)`. */
export function Loaded<T>({
  load,
  reload,
  children,
}: {
  load: Load<T>;
  reload: () => void;
  children: (data: T) => React.ReactNode;
}) {
  const t = useT();
  if (load.status === "loading") {
    return (
      <p className="py-12 text-center text-ink-soft" aria-busy>
        {t.loading}
      </p>
    );
  }
  if (load.status === "error") {
    return (
      <StatusPanel
        title={t.somethingWrong}
        message={errorMessage(t, load.error)}
        action={
          <Button variant="primary" onClick={reload}>
            {t.retry}
          </Button>
        }
      />
    );
  }
  return children(load.data);
}

/** Runs a change with a pending flag and a localized error or success notice. */
export function useRun() {
  const t = useT();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  async function run(action: () => Promise<unknown>, success?: string): Promise<boolean> {
    setPending(true);
    setMessage(null);
    try {
      await action();
      if (success) {
        setMessage({ tone: "info", text: success });
      }
      return true;
    } catch (error) {
      setMessage({ tone: "error", text: errorMessage(t, error) });
      return false;
    } finally {
      setPending(false);
    }
  }
  const notice = message ? <Notice tone={message.tone}>{message.text}</Notice> : null;
  return { run, pending, notice, say: setMessage };
}

/** Pages for signed-in customers: a guest is sent to sign-in. */
export function CustomerOnly({ children }: { children: React.ReactNode }) {
  const t = useT();
  const { shopper } = useShopper();
  useEffect(() => {
    if (shopper.status === "guest") {
      redirectToLogin("required");
    }
  }, [shopper.status]);
  if (shopper.status !== "customer") {
    return (
      <p className="py-12 text-center text-ink-soft" aria-busy>
        {t.loading}
      </p>
    );
  }
  return children;
}

export function Page({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto w-full max-w-[1360px] flex-1 px-4 py-8 md:px-8">{children}</main>;
}

export function PageTitle({ children, aside }: { children: string; aside?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <h1 className="font-[family-name:var(--font-display)] text-3xl text-plum md:text-4xl">
        {children}
      </h1>
      {aside}
    </div>
  );
}

export function Button({
  variant = "secondary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "link" }) {
  const look = {
    primary:
      "rounded-md bg-plum px-4 py-2.5 text-sm font-semibold tracking-wide text-white uppercase hover:bg-plum-soft",
    secondary:
      "rounded-md border border-line bg-white px-3 py-2 text-sm text-ink hover:border-plum",
    link: "text-sm text-plum underline-offset-4 hover:underline",
  }[variant];
  return (
    <button
      type="button"
      {...props}
      className={`${look} transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    />
  );
}

/** Product image from the API (public file URLs); a soft block when there is none. */
export function ProductImage({
  src,
  alt,
  className = "",
}: {
  src: string | null | undefined;
  alt: string;
  className?: string;
}) {
  if (!src) {
    return <div className={`bg-velvet-low ${className}`} aria-hidden />;
  }
  // eslint-disable-next-line @next/next/no-img-element -- API file URLs, already size-checked on upload
  return <img src={src} alt={alt} loading="lazy" className={`object-cover ${className}`} />;
}

export function Money({ value, className }: { value: number; className?: string }) {
  const lang = useLang();
  return <span className={className}>{formatMoney(value, lang)}</span>;
}

/** "From X" when the variants have different prices. */
export function PriceRange({ min, max }: { min: number; max: number }) {
  const t = useT();
  const lang = useLang();
  return (
    <span className="text-lg font-semibold text-ink">
      {min === max
        ? formatMoney(min, lang)
        : t.shop.fromPrice.replace("{price}", formatMoney(min, lang))}
    </span>
  );
}

export function ProductCard({ product }: { product: ProductSummary }) {
  const t = useT();
  const soldOut = product.status === "OUT_OF_STOCK";
  return (
    <Link
      href={`/products/${product.slug}`}
      className="group flex flex-col overflow-hidden rounded-xl border border-line bg-white transition-shadow hover:shadow-md"
    >
      <div className="relative aspect-square">
        <ProductImage
          src={product.image?.url}
          alt={product.image?.alt ?? product.name}
          className={`h-full w-full ${soldOut ? "opacity-60" : ""}`}
        />
        {soldOut ? (
          <span className="absolute start-3 top-3 rounded bg-ink px-2 py-0.5 text-[10px] font-bold tracking-wider text-white uppercase">
            {t.shop.outOfStock}
          </span>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-4">
        {product.brand ? (
          <span className="text-[11px] tracking-[0.15em] text-ink-soft uppercase">
            {product.brand.name}
          </span>
        ) : null}
        <span className="text-ink group-hover:text-plum">{product.name}</span>
        <span className="mt-auto pt-3">
          <PriceRange min={product.minPrice} max={product.maxPrice} />
        </span>
      </div>
    </Link>
  );
}

/** Previous / next page links that keep the other query values. */
export function Pager({
  page,
  totalPages,
  href,
}: {
  page: number;
  totalPages: number;
  href: (page: number) => string;
}) {
  const t = useT();
  if (totalPages <= 1) {
    return null;
  }
  const link = "rounded-md border border-line bg-white px-3 py-2 text-sm hover:border-plum";
  return (
    <nav aria-label={t.shop.pages} className="mt-8 flex items-center justify-center gap-3">
      {page > 1 ? (
        <Link href={href(page - 1)} className={link}>
          {t.shop.previous}
        </Link>
      ) : null}
      <span className="text-sm text-ink-soft">
        {t.shop.pageOf.replace("{page}", String(page)).replace("{total}", String(totalPages))}
      </span>
      {page < totalPages ? (
        <Link href={href(page + 1)} className={link}>
          {t.shop.next}
        </Link>
      ) : null}
    </nav>
  );
}

/** Quantity stepper; the API refuses quantities above the stock. */
export function QuantityInput({
  value,
  onChange,
  disabled,
  label,
}: {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <div className="inline-flex items-center rounded-md border border-line bg-white">
      <button
        type="button"
        aria-label="−"
        disabled={disabled || value <= 1}
        onClick={() => onChange(value - 1)}
        className="px-3 py-2 disabled:opacity-40"
      >
        −
      </button>
      <span aria-label={label} className="min-w-8 text-center text-sm">
        {value}
      </span>
      <button
        type="button"
        aria-label="+"
        disabled={disabled || value >= 999}
        onClick={() => onChange(value + 1)}
        className="px-3 py-2 disabled:opacity-40"
      >
        +
      </button>
    </div>
  );
}
