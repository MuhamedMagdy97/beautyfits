"use client";

import { createContext, use, useCallback, useEffect, useState } from "react";
import { redirectToLogin, StaffApiError, staffApi, staffPost } from "./api";

/** `GET /api/v1/employee-auth/session` (API contract, TASK-011/012 amendments). */
export interface StaffSession {
  account: { id: string; email: string; status: string };
  employee: { id: string; displayName: string; level: string; department: string | null };
  session: { expiresAt: string; idleTimeoutSeconds: number };
  permissions: string[];
}

type State =
  | { status: "loading" }
  | { status: "ready"; session: StaffSession }
  | { status: "error"; error: unknown };

interface SessionValue {
  session: StaffSession;
  signOut: (everywhere?: boolean) => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

/** The signed-in employee; only usable inside the dashboard shell. */
export function useStaffSession(): SessionValue {
  const value = use(SessionContext);
  if (!value) {
    throw new Error("useStaffSession must be used inside the staff shell.");
  }
  return value;
}

/**
 * Loads the employee session for the shell. An ended session sends the
 * employee to sign-in; other failures show `renderError`. The session's
 * 12-hour maximum also ends the page on time; the idle limit is enforced by
 * the API on the next request.
 */
export function StaffSessionProvider({
  children,
  renderLoading,
  renderError,
}: {
  children: React.ReactNode;
  renderLoading: () => React.ReactNode;
  renderError: (error: unknown, retry: () => void) => React.ReactNode;
}) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    staffApi<StaffSession>("/api/v1/employee-auth/session").then(
      (session) => active && setState({ status: "ready", session }),
      (error: unknown) => {
        if (!active) {
          return;
        }
        if (error instanceof StaffApiError && error.code === "UNAUTHENTICATED") {
          redirectToLogin("expired");
        } else {
          setState({ status: "error", error });
        }
      },
    );
    return () => {
      active = false;
    };
  }, [attempt]);

  const expiresAt = state.status === "ready" ? state.session.session.expiresAt : null;
  useEffect(() => {
    if (!expiresAt) {
      return;
    }
    // ponytail: setTimeout caps near 24.8 days; staff sessions last at most 12 hours.
    const timer = setTimeout(
      () => redirectToLogin("expired"),
      Math.max(0, new Date(expiresAt).getTime() - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [expiresAt]);

  const signOut = useCallback(async (everywhere = false) => {
    try {
      await staffPost(`/api/v1/employee-auth/${everywhere ? "logout-all" : "logout"}`);
    } catch {
      // The session may already be gone; sign-in is the right place either way.
    }
    redirectToLogin("signed-out");
  }, []);

  if (state.status === "loading") {
    return renderLoading();
  }
  if (state.status === "error") {
    return renderError(state.error, () => {
      setState({ status: "loading" });
      setAttempt((n) => n + 1);
    });
  }
  return <SessionContext value={{ session: state.session, signOut }}>{children}</SessionContext>;
}
