import { BlockList, isIP } from "node:net";
import { getEnv } from "@/server/config/env";
import { logger } from "@/server/logging/logger";

/**
 * Client IP resolution (ADR-0013).
 *
 * Next.js route handlers cannot see the socket address, and the Next.js
 * server copies it into `X-Forwarded-For` only when the client did not send
 * that header. So the thin custom server (`server.mjs`) writes the socket
 * address into `DIRECT_ADDRESS_HEADER`, replacing any client-supplied value,
 * and marks the process with `CUSTOM_SERVER_MARKER`.
 *
 * - The direct address is the client, unless it belongs to `TRUSTED_PROXIES`.
 * - Only then are `X-Forwarded-For` (walked from the right, skipping trusted
 *   proxies) and `X-Real-IP` used. A forged forwarding header sent straight
 *   to the app is therefore ignored.
 * - Without the custom server the address cannot be trusted: the result is
 *   null, and callers put such requests in one shared "unknown" bucket so a
 *   forged header can never create fresh per-IP limits.
 */
export const DIRECT_ADDRESS_HEADER = "x-beautyfits-direct-address";
export const CUSTOM_SERVER_MARKER = Symbol.for("beautyfits.customServer");

export type TrustedProxyMatcher = (ip: string) => boolean;

/**
 * Normalizes one address: trims, removes an IPv4 port (`1.2.3.4:5678`) or
 * IPv6 brackets/port (`[::1]:443`), and unwraps IPv4-mapped IPv6
 * (`::ffff:1.2.3.4`). Returns null for anything that is not an IP address.
 */
export function normalizeIp(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  let candidate = value.trim();
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(candidate);
  if (bracketed) {
    candidate = bracketed[1];
  } else if (/^[\d.]+:\d+$/.test(candidate)) {
    candidate = candidate.slice(0, candidate.lastIndexOf(":"));
  }
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(candidate);
  if (mapped) {
    candidate = mapped[1];
  }
  const version = isIP(candidate);
  if (version === 0) {
    return null;
  }
  return version === 6 ? candidate.toLowerCase() : candidate;
}

/** Builds a matcher for a list of IP addresses and CIDR blocks. */
export function createTrustedProxyMatcher(entries: readonly string[]): TrustedProxyMatcher {
  if (entries.length === 0) {
    return () => false;
  }
  const list = new BlockList();
  for (const entry of entries) {
    const [address, prefix] = entry.split("/");
    const family = isIP(address) === 6 ? "ipv6" : "ipv4";
    if (prefix === undefined) {
      list.addAddress(address, family);
    } else {
      list.addSubnet(address, Number(prefix), family);
    }
  }
  return (ip) => list.check(ip, isIP(ip) === 6 ? "ipv6" : "ipv4");
}

/**
 * Resolves the client address from request headers. `directAddress` is the
 * socket peer (from the custom server); null means it is unknown.
 */
export function resolveClientIp(
  headers: Headers,
  directAddress: string | null,
  isTrustedProxy: TrustedProxyMatcher,
): string | null {
  const direct = normalizeIp(directAddress);
  if (direct === null || !isTrustedProxy(direct)) {
    return direct;
  }

  // The request came through a trusted proxy. X-Forwarded-For lists the
  // hops left to right; the closest untrusted hop is the client. (Next.js
  // fills X-Forwarded-For with the proxy's own address when the proxy only
  // sets X-Real-IP, so an all-trusted list falls through to X-Real-IP.)
  let nearest = direct;
  const forwarded = headers.get("x-forwarded-for");
  for (const hop of forwarded ? forwarded.split(",").reverse() : []) {
    const ip = normalizeIp(hop);
    if (ip === null) {
      // Malformed entry: stop at the last address a trusted proxy vouched for.
      return nearest;
    }
    if (!isTrustedProxy(ip)) {
      return ip;
    }
    nearest = ip;
  }

  return normalizeIp(headers.get("x-real-ip")) ?? nearest;
}

let cachedMatcher: { entries: readonly string[]; matcher: TrustedProxyMatcher } | undefined;
let warnedMissingServer = false;

function trustedProxyMatcher(): TrustedProxyMatcher {
  const entries = getEnv().TRUSTED_PROXIES;
  if (cachedMatcher?.entries === entries) {
    return cachedMatcher.matcher;
  }
  const matcher = createTrustedProxyMatcher(entries);
  cachedMatcher = { entries, matcher };
  return matcher;
}

export function isCustomServerActive(): boolean {
  return (globalThis as Record<symbol, unknown>)[CUSTOM_SERVER_MARKER] === true;
}

/** The client address of a request, or null when it cannot be trusted. */
export function getClientIp(request: Request): string | null {
  if (!isCustomServerActive()) {
    if (!warnedMissingServer && getEnv().NODE_ENV !== "test") {
      warnedMissingServer = true;
      logger.warn(
        "Client IP unknown: the app is not running behind server.mjs; per-IP limits share one bucket",
      );
    }
    return null;
  }
  return resolveClientIp(
    request.headers,
    request.headers.get(DIRECT_ADDRESS_HEADER),
    trustedProxyMatcher(),
  );
}
