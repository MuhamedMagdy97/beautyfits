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
} as const;

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
];

const DEFINITIONS_BY_KEY = new Map(SETTING_DEFINITIONS.map((d) => [d.key, d]));

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
