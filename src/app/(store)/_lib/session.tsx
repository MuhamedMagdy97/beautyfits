"use client";

import { createContext, use, useCallback, useEffect, useState } from "react";
import { getGuestCartToken, setGuestCartToken, StoreApiError, storeApi, storePost } from "./api";

/** `GET /api/v1/auth/session` (API contract, TASK-007 amendments). */
export interface CustomerSession {
  account: {
    id: string;
    email: string;
    status: string;
    emailVerified: boolean;
    phoneVerified: boolean;
  };
  customer: { id: string; fullName: string; phone: string; preferredLocale: "ar" | "en" };
  session: { expiresAt: string };
}

/** Who is shopping: still loading, a guest, or a signed-in customer. */
export type Shopper =
  { status: "loading" } | { status: "guest" } | { status: "customer"; session: CustomerSession };

interface ShopperValue {
  shopper: Shopper;
  /** Lines in the cart (`cart.itemCount`); 0 until loaded. */
  cartCount: number;
  /** Re-read the session and the cart, e.g. after a cart change. */
  reload: () => void;
  signOut: (everywhere?: boolean) => Promise<void>;
}

const ShopperContext = createContext<ShopperValue | null>(null);

export function useShopper(): ShopperValue {
  const value = use(ShopperContext);
  if (!value) {
    throw new Error("useShopper must be used inside the storefront layout.");
  }
  return value;
}

/** The signed-in customer, or null for a guest (and while loading). */
async function loadSession(): Promise<CustomerSession | null> {
  try {
    return await storeApi<CustomerSession>("/api/v1/auth/session");
  } catch (error) {
    if (error instanceof StoreApiError && error.code === "UNAUTHENTICATED") {
      return null;
    }
    throw error;
  }
}

/**
 * Guest cart → customer cart after sign-in (R33). The merge is safe to retry
 * (an unknown or merged token changes nothing), so the token is dropped only
 * once the API answered.
 */
export async function mergeGuestCart(): Promise<void> {
  const token = getGuestCartToken();
  if (!token) {
    return;
  }
  await storePost("/api/v1/cart/merge");
  setGuestCartToken(null);
}

/**
 * Loads the shopper once per page load (no polling). Browsing never needs a
 * session, so any failure leaves the page usable as a guest; pages that
 * require a customer check `shopper.status` and call `redirectToLogin`.
 */
export function ShopperProvider({ children }: { children: React.ReactNode }) {
  const [shopper, setShopper] = useState<Shopper>({ status: "loading" });
  const [cartCount, setCartCount] = useState(0);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    (async () => {
      let session: CustomerSession | null = null;
      try {
        session = await loadSession();
        if (session) {
          await mergeGuestCart();
        }
      } catch {
        // Network or server trouble: browsing still works; the next page load retries
        // (a failed merge keeps the token for that retry).
      }
      if (!active) {
        return;
      }
      setShopper(session ? { status: "customer", session } : { status: "guest" });
      if (!session && !getGuestCartToken()) {
        setCartCount(0);
        return;
      }
      try {
        const cart = await storeApi<{ itemCount: number }>("/api/v1/cart");
        if (active) {
          setCartCount(cart.itemCount);
        }
      } catch {
        // The badge is informational; the cart page shows real errors.
      }
    })();
    return () => {
      active = false;
    };
  }, [attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  const signOut = useCallback(async (everywhere = false) => {
    try {
      await storePost(`/api/v1/auth/${everywhere ? "logout-all" : "logout"}`);
    } catch {
      // The session may already be gone; the home page is the right place either way.
    }
    window.location.replace("/");
  }, []);

  return (
    <ShopperContext value={{ shopper, cartCount, reload, signOut }}>{children}</ShopperContext>
  );
}
