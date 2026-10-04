import type { Area, Governorate, LocationStatus, PrismaClient } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { runInTransaction, type Db } from "@/server/db/transaction";
import { AppError } from "@/server/errors/app-error";
import type { SupportedLocale } from "@/server/http/locale";
import type { Logger } from "@/server/logging/logger";
import { AUDIT_ENTITY_TYPES, employeeActor, recordAudit } from "@/server/modules/audit/audit";
import { conflict, isUniqueViolation, validationError } from "@/server/modules/catalog/errors";
import type { CreateAreaInput, UpdateLocationInput } from "@/server/modules/locations/schemas";
import { systemClock, type Clock } from "@/server/time/time";

/**
 * Governorates and areas (TASK-009, Business Spec R32, ADR-0030): one managed
 * list shared by customer addresses and shipping rules (TASK-027).
 *
 * - The 27 governorates come from the migration; areas are added by staff.
 * - Nothing is deleted (triggers); `INACTIVE` hides an entry from customers
 *   and stops new addresses using it. Existing addresses keep it.
 * - Every change writes an audit entry in its transaction.
 */

export interface LocationActor {
  employeeId: string;
}

export interface PublicGovernorate {
  id: string;
  code: string;
  name: string;
  areas: { id: string; name: string }[];
}

export interface AdminArea {
  id: string;
  governorateId: string;
  nameAr: string;
  nameEn: string;
  status: LocationStatus;
}

export interface AdminGovernorate {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  status: LocationStatus;
  areas: AdminArea[];
}

/** A usable area with its governorate, for addresses. */
export type AreaWithGovernorate = Area & { governorate: Governorate };

function adminArea(area: Area): AdminArea {
  return {
    id: area.id,
    governorateId: area.governorateId,
    nameAr: area.nameAr,
    nameEn: area.nameEn,
    status: area.status,
  };
}

function snapshot(row: { nameAr: string; nameEn: string; status: LocationStatus }) {
  return { nameAr: row.nameAr, nameEn: row.nameEn, status: row.status };
}

export function localName(row: { nameAr: string; nameEn: string }, locale: SupportedLocale) {
  return locale === "ar" ? row.nameAr : row.nameEn;
}

function nameTaken(): AppError {
  return conflict("Another area of this governorate already uses this name.", {
    reason: "NAME_TAKEN",
  });
}

/**
 * The area an address may use (R32): it must exist and be active, and so
 * must its governorate. Otherwise `400`, issue code `area_not_found` or
 * `area_inactive` on `areaId`.
 */
export async function findUsableArea(db: Db, areaId: string): Promise<AreaWithGovernorate> {
  const area = await db.area.findUnique({ where: { id: areaId }, include: { governorate: true } });
  if (!area) {
    throw validationError("areaId", "area_not_found", "Choose an area from the list.");
  }
  if (area.status !== "ACTIVE" || area.governorate.status !== "ACTIVE") {
    throw validationError("areaId", "area_inactive", "This area is no longer available.");
  }
  return area;
}

export function createLocationsService(deps: { db: PrismaClient; clock: Clock }) {
  const { db, clock } = deps;

  /** `GET /locations`: active governorates with their active areas. */
  async function listPublic(locale: SupportedLocale): Promise<PublicGovernorate[]> {
    const rows = await db.governorate.findMany({
      where: { status: "ACTIVE" },
      orderBy: { sortOrder: "asc" },
      include: { areas: { where: { status: "ACTIVE" } } },
    });
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: localName(row, locale),
      areas: row.areas
        .map((area) => ({ id: area.id, name: localName(area, locale) }))
        .sort((a, b) => a.name.localeCompare(b.name, locale)),
    }));
  }

  /** `GET /admin/locations`: everything, both languages. */
  async function listAdmin(): Promise<AdminGovernorate[]> {
    const rows = await db.governorate.findMany({
      orderBy: { sortOrder: "asc" },
      include: { areas: { orderBy: [{ nameEn: "asc" }, { id: "asc" }] } },
    });
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      ...snapshot(row),
      areas: row.areas.map(adminArea),
    }));
  }

  async function updateGovernorate(
    actor: LocationActor,
    governorateId: string,
    input: UpdateLocationInput,
    logger: Logger,
    correlationId: string | null = null,
  ): Promise<AdminGovernorate> {
    const now = clock.now();
    const updated = await runInTransaction(
      async (tx) => {
        const existing = await tx.governorate.findUnique({ where: { id: governorateId } });
        if (!existing) {
          throw new AppError("NOT_FOUND", "Governorate not found.");
        }
        const row = await tx.governorate.update({
          where: { id: governorateId },
          data: { ...input, updatedAt: now },
          include: { areas: { orderBy: [{ nameEn: "asc" }, { id: "asc" }] } },
        });
        await recordAudit(tx, {
          actor: employeeActor(actor.employeeId),
          action: "GOVERNORATE_UPDATED",
          entityType: AUDIT_ENTITY_TYPES.governorate,
          entityId: governorateId,
          previous: snapshot(existing),
          next: snapshot(row),
          correlationId,
          createdAt: now,
        });
        return row;
      },
      {},
      db,
    );
    logger.info("governorate updated", { governorateId, actorEmployeeId: actor.employeeId });
    return {
      id: updated.id,
      code: updated.code,
      ...snapshot(updated),
      areas: updated.areas.map(adminArea),
    };
  }

  async function createArea(
    actor: LocationActor,
    governorateId: string,
    input: CreateAreaInput,
    logger: Logger,
    correlationId: string | null = null,
  ): Promise<AdminArea> {
    const now = clock.now();
    try {
      const area = await runInTransaction(
        async (tx) => {
          const governorate = await tx.governorate.findUnique({ where: { id: governorateId } });
          if (!governorate) {
            throw new AppError("NOT_FOUND", "Governorate not found.");
          }
          const created = await tx.area.create({
            data: { governorateId, ...input, createdAt: now, updatedAt: now },
          });
          await recordAudit(tx, {
            actor: employeeActor(actor.employeeId),
            action: "AREA_CREATED",
            entityType: AUDIT_ENTITY_TYPES.area,
            entityId: created.id,
            next: { governorateId, ...snapshot(created) },
            correlationId,
            createdAt: now,
          });
          return created;
        },
        {},
        db,
      );
      logger.info("area created", { areaId: area.id, actorEmployeeId: actor.employeeId });
      return adminArea(area);
    } catch (error) {
      if (isUniqueViolation(error, "name_")) {
        throw nameTaken();
      }
      throw error;
    }
  }

  async function updateArea(
    actor: LocationActor,
    areaId: string,
    input: UpdateLocationInput,
    logger: Logger,
    correlationId: string | null = null,
  ): Promise<AdminArea> {
    const now = clock.now();
    try {
      const area = await runInTransaction(
        async (tx) => {
          const existing = await tx.area.findUnique({ where: { id: areaId } });
          if (!existing) {
            throw new AppError("NOT_FOUND", "Area not found.");
          }
          const row = await tx.area.update({
            where: { id: areaId },
            data: { ...input, updatedAt: now },
          });
          await recordAudit(tx, {
            actor: employeeActor(actor.employeeId),
            action: "AREA_UPDATED",
            entityType: AUDIT_ENTITY_TYPES.area,
            entityId: areaId,
            previous: snapshot(existing),
            next: snapshot(row),
            correlationId,
            createdAt: now,
          });
          return row;
        },
        {},
        db,
      );
      logger.info("area updated", { areaId, actorEmployeeId: actor.employeeId });
      return adminArea(area);
    } catch (error) {
      if (isUniqueViolation(error, "name_")) {
        throw nameTaken();
      }
      throw error;
    }
  }

  return { listPublic, listAdmin, updateGovernorate, createArea, updateArea };
}

export type LocationsService = ReturnType<typeof createLocationsService>;

let defaultService: LocationsService | undefined;

export function getLocationsService(): LocationsService {
  defaultService ??= createLocationsService({ db: getDb(), clock: systemClock });
  return defaultService;
}
