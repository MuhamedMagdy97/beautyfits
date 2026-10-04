import type { SettingDataType } from "@/generated/prisma/client";
import type { Db } from "@/server/db/transaction";
import { logger as defaultLogger, type Logger } from "@/server/logging/logger";
import {
  DEFAULT_STAFF_SESSION_SETTINGS,
  type StaffSessionSettings,
} from "@/server/modules/auth/policy";
import { MS_PER_MINUTE } from "@/server/time/time";

/**
 * Owner/Admin-configurable settings (DB design §20, Q179; TASK-004, ADR-0017).
 *
 * Every known key is listed here with its type and default. The bootstrap
 * inserts missing keys with their default and never overwrites a stored
 * value. Readers fall back to the default when a row is missing or invalid,
 * so a fresh database behaves exactly as the documented defaults.
 *
 * Changing a value (with history and approval for critical settings, Q180,
 * Q181) comes with the settings screen (TASK-057).
 */

interface SettingDefinition {
  key: string;
  dataType: SettingDataType;
  defaultValue: unknown;
  /** True when a stored value is acceptable. */
  isValid(value: unknown): boolean;
  /** Where the default comes from. */
  source: string;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export const SETTING_KEYS = {
  staffSessionMaxLifetimeMinutes: "staff_session.max_lifetime_minutes",
  staffSessionIdleTimeoutMinutes: "staff_session.idle_timeout_minutes",
  catalogMaxImagesPerProduct: "catalog.max_images_per_product",
  pricingMinMarginBasisPoints: "pricing.min_margin_basis_points",
  cartGuestExpiryDays: "cart.guest_expiry_days",
} as const;

/** Default image limit per product (Q177 "configurable"; ADR-0021). */
export const DEFAULT_MAX_IMAGES_PER_PRODUCT = 20;

/** Margin below which a selling-price review warns: 10% (Q102, Q111; ADR-0023 §4 item 2). */
export const DEFAULT_MIN_MARGIN_BASIS_POINTS = 1000;

/** A guest cart expires after 30 days without changes (Business Spec R35). */
export const DEFAULT_GUEST_CART_EXPIRY_DAYS = 30;

/** A margin in basis points from 0% up to, not including, 100%. */
function isMarginBasisPoints(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value < 10_000;
}

export const SETTING_DEFINITIONS: readonly SettingDefinition[] = [
  {
    key: SETTING_KEYS.staffSessionMaxLifetimeMinutes,
    dataType: "INTEGER",
    defaultValue: DEFAULT_STAFF_SESSION_SETTINGS.maxLifetimeMs / MS_PER_MINUTE,
    isValid: isPositiveInteger,
    source: "Business Spec R29 (12 hours)",
  },
  {
    key: SETTING_KEYS.staffSessionIdleTimeoutMinutes,
    dataType: "INTEGER",
    defaultValue: DEFAULT_STAFF_SESSION_SETTINGS.idleTimeoutMs / MS_PER_MINUTE,
    isValid: isPositiveInteger,
    source: "Business Spec R29 (60 minutes)",
  },
  {
    key: SETTING_KEYS.catalogMaxImagesPerProduct,
    dataType: "INTEGER",
    defaultValue: DEFAULT_MAX_IMAGES_PER_PRODUCT,
    isValid: isPositiveInteger,
    source: "Business Spec Q177 (configurable); default ADR-0021",
  },
  {
    key: SETTING_KEYS.pricingMinMarginBasisPoints,
    dataType: "INTEGER",
    defaultValue: DEFAULT_MIN_MARGIN_BASIS_POINTS,
    isValid: isMarginBasisPoints,
    source: "Business Spec Q102, Q111; 10% decided by the product owner (ADR-0023)",
  },
  {
    key: SETTING_KEYS.cartGuestExpiryDays,
    dataType: "INTEGER",
    defaultValue: DEFAULT_GUEST_CART_EXPIRY_DAYS,
    isValid: isPositiveInteger,
    source: "Business Spec R35 (30 days)",
  },
];

const DEFINITIONS_BY_KEY = new Map(SETTING_DEFINITIONS.map((d) => [d.key, d]));

/**
 * The stored value of an integer setting, or its default when the row is
 * missing or invalid (an invalid row is logged).
 */
async function readIntegerSetting(db: Db, key: string, log: Logger): Promise<number> {
  const definition = DEFINITIONS_BY_KEY.get(key)!;
  const row = await db.setting.findUnique({ where: { key }, select: { valueJson: true } });
  if (!row) {
    return definition.defaultValue as number;
  }
  if (!definition.isValid(row.valueJson)) {
    log.warn("settings.invalid_value", { key });
    return definition.defaultValue as number;
  }
  return row.valueJson as number;
}

/** How many images a product may have, its variants' images included (Q177). */
export async function readMaxImagesPerProduct(
  db: Db,
  log: Logger = defaultLogger,
): Promise<number> {
  return readIntegerSetting(db, SETTING_KEYS.catalogMaxImagesPerProduct, log);
}

/** The margin (basis points) below which selling-price reviews warn (ADR-0023). */
export async function readMinMarginBasisPoints(
  db: Db,
  log: Logger = defaultLogger,
): Promise<number> {
  return readIntegerSetting(db, SETTING_KEYS.pricingMinMarginBasisPoints, log);
}

/** Days without changes after which a guest cart expires (R35). */
export async function readGuestCartExpiryDays(
  db: Db,
  log: Logger = defaultLogger,
): Promise<number> {
  return readIntegerSetting(db, SETTING_KEYS.cartGuestExpiryDays, log);
}

/**
 * Current staff session lengths (R29, Q163). Missing or invalid rows fall
 * back to the R29 defaults (an invalid row is logged).
 */
export async function readStaffSessionSettings(
  db: Db,
  log: Logger = defaultLogger,
): Promise<StaffSessionSettings> {
  const keys = [
    SETTING_KEYS.staffSessionMaxLifetimeMinutes,
    SETTING_KEYS.staffSessionIdleTimeoutMinutes,
  ];
  const rows = await db.setting.findMany({
    where: { key: { in: keys } },
    select: { key: true, valueJson: true },
  });
  const stored = new Map(rows.map((row) => [row.key, row.valueJson as unknown]));

  function minutes(key: string): number {
    const definition = DEFINITIONS_BY_KEY.get(key)!;
    if (!stored.has(key)) {
      return definition.defaultValue as number;
    }
    const value = stored.get(key);
    if (!definition.isValid(value)) {
      log.warn("settings.invalid_value", { key });
      return definition.defaultValue as number;
    }
    return value as number;
  }

  return {
    maxLifetimeMs: minutes(SETTING_KEYS.staffSessionMaxLifetimeMinutes) * MS_PER_MINUTE,
    idleTimeoutMs: minutes(SETTING_KEYS.staffSessionIdleTimeoutMinutes) * MS_PER_MINUTE,
  };
}
