import type { PrismaClient } from "@/generated/prisma/client";
import type { Logger } from "@/server/logging/logger";
import { BootstrapError } from "@/server/modules/bootstrap/bootstrap";
import { createLocationsService } from "@/server/modules/locations/locations-service";
import { createShippingService } from "@/server/modules/shipping/shipping-service";
import type { Clock } from "@/server/time/time";

/**
 * Development sample delivery areas and one shipping rule, so the storefront
 * checkout works locally (part of `npm run db:seed:dev`; never in production).
 *
 * Real areas and rules are managed by the Owner/Admin (Business Spec R32,
 * TASK-027). These are sample data only: the fee is a placeholder, not a
 * business decision. Idempotent: existing areas are kept, and the rule is
 * only added while no shipping rule exists at all.
 */

/** Areas by governorate code (the 27 governorates are preloaded). */
export const SAMPLE_AREAS: Record<string, { nameEn: string; nameAr: string }[]> = {
  C: [
    { nameEn: "Nasr City", nameAr: "مدينة نصر" },
    { nameEn: "Heliopolis", nameAr: "مصر الجديدة" },
    { nameEn: "Maadi", nameAr: "المعادي" },
    { nameEn: "New Cairo", nameAr: "القاهرة الجديدة" },
    { nameEn: "Downtown", nameAr: "وسط البلد" },
    { nameEn: "Zamalek", nameAr: "الزمالك" },
    { nameEn: "Shubra", nameAr: "شبرا" },
  ],
  GZ: [
    { nameEn: "Dokki", nameAr: "الدقي" },
    { nameEn: "Mohandessin", nameAr: "المهندسين" },
    { nameEn: "Haram", nameAr: "الهرم" },
    { nameEn: "6th of October", nameAr: "السادس من أكتوبر" },
    { nameEn: "Sheikh Zayed", nameAr: "الشيخ زايد" },
  ],
  ALX: [
    { nameEn: "Smouha", nameAr: "سموحة" },
    { nameEn: "Sidi Gaber", nameAr: "سيدي جابر" },
    { nameEn: "Miami", nameAr: "ميامي" },
    { nameEn: "Montaza", nameAr: "المنتزه" },
    { nameEn: "Agami", nameAr: "العجمي" },
  ],
};

/** Placeholder fee of the sample catch-all rule: 60.00 EGP. */
export const SAMPLE_SHIPPING_FEE = 6000;

export interface DevLocationsReport {
  areasCreated: number;
  shippingRulesCreated: number;
}

export async function runDevLocationsSeed(
  deps: { db: PrismaClient; clock: Clock; logger: Logger },
  input: { nodeEnv: string },
): Promise<DevLocationsReport> {
  const { db, clock, logger } = deps;
  if (input.nodeEnv === "production") {
    throw new BootstrapError("The development seed never runs with NODE_ENV=production.");
  }
  const owner = await db.employee.findFirst({
    where: { employeeLevel: "OWNER" },
    select: { id: true },
  });
  if (!owner) {
    throw new BootstrapError(
      "No Owner exists yet. Run `npm run db:seed` with the Owner details first.",
    );
  }
  const actor = { employeeId: owner.id };
  const locations = createLocationsService({ db, clock });
  const shipping = createShippingService({ db, clock });
  const report: DevLocationsReport = { areasCreated: 0, shippingRulesCreated: 0 };

  for (const [code, areas] of Object.entries(SAMPLE_AREAS)) {
    const governorate = await db.governorate.findUnique({ where: { code }, select: { id: true } });
    if (!governorate) continue;
    for (const area of areas) {
      const exists = await db.area.findFirst({
        where: { governorateId: governorate.id, nameEn: area.nameEn },
        select: { id: true },
      });
      if (!exists) {
        await locations.createArea(actor, governorate.id, area, logger);
        report.areasCreated += 1;
      }
    }
  }

  if ((await db.shippingRule.count()) === 0) {
    await shipping.createRule(
      actor,
      {
        shippingCompanyId: null,
        governorateId: null,
        areaId: null,
        minOrderTotal: null,
        maxOrderTotal: null,
        shippingFee: BigInt(SAMPLE_SHIPPING_FEE),
        priority: 0,
        activeFrom: null,
        activeTo: null,
        status: "ACTIVE",
      },
      logger,
    );
    report.shippingRulesCreated += 1;
  }

  logger.info("dev_locations_seed.completed", { ...report });
  return report;
}
