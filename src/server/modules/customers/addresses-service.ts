import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { runInTransaction, type Db } from "@/server/db/transaction";
import { AppError } from "@/server/errors/app-error";
import type { SupportedLocale } from "@/server/http/locale";
import { conflict } from "@/server/modules/catalog/errors";
import type { CreateAddressInput, UpdateAddressInput } from "@/server/modules/customers/schemas";
import { findUsableArea, localName } from "@/server/modules/locations/locations-service";
import { systemClock, type Clock } from "@/server/time/time";

/**
 * Customer addresses (TASK-009, Q45, Q46, DB design §3.3, R32, ADR-0030).
 *
 * - Every query is scoped to the signed-in customer: another customer's
 *   address answers 404.
 * - At most one default (partial unique index); the first address becomes
 *   the default and deleting the default promotes the most recently updated
 *   remaining address.
 * - New or moved addresses need an active area of an active governorate.
 * - Writes lock the customer row, so the limit and the default stay right
 *   under concurrent requests.
 * - Orders keep their own snapshot (Q46), so an address can be deleted.
 */

export const MAX_ADDRESSES = 20;

export interface AddressView {
  id: string;
  label: string | null;
  recipientName: string;
  phone: string;
  governorate: { id: string; code: string; name: string; active: boolean };
  area: { id: string; name: string; active: boolean };
  city: string | null;
  street: string;
  building: string | null;
  floor: string | null;
  apartment: string | null;
  landmark: string | null;
  notes: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

const WITH_AREA = { area: { include: { governorate: true } } } as const;

type AddressRow = Prisma.CustomerAddressGetPayload<{ include: typeof WITH_AREA }>;

function toView(row: AddressRow, locale: SupportedLocale): AddressView {
  const { area } = row;
  const { governorate } = area;
  return {
    id: row.id,
    label: row.label,
    recipientName: row.recipientName,
    phone: row.phone,
    governorate: {
      id: governorate.id,
      code: governorate.code,
      name: localName(governorate, locale),
      active: governorate.status === "ACTIVE",
    },
    area: {
      id: area.id,
      name: localName(area, locale),
      active: area.status === "ACTIVE" && governorate.status === "ACTIVE",
    },
    city: row.city,
    street: row.street,
    building: row.building,
    floor: row.floor,
    apartment: row.apartment,
    landmark: row.landmark,
    notes: row.notes,
    isDefault: row.isDefault,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function addressNotFound(): AppError {
  return new AppError("NOT_FOUND", "Address not found.");
}

async function lockCustomer(tx: Db, customerId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM customers WHERE id = ${customerId}::uuid FOR UPDATE`;
}

async function findOwn(tx: Db, customerId: string, addressId: string) {
  const row = await tx.customerAddress.findFirst({ where: { id: addressId, customerId } });
  if (!row) {
    throw addressNotFound();
  }
  return row;
}

export function createAddressesService(deps: { db: PrismaClient; clock: Clock }) {
  const { db, clock } = deps;

  /** Default first, then newest first. */
  async function listAddresses(customerId: string, locale: SupportedLocale) {
    const rows = await db.customerAddress.findMany({
      where: { customerId },
      include: WITH_AREA,
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    });
    return rows.map((row) => toView(row, locale));
  }

  async function createAddress(
    customerId: string,
    input: CreateAddressInput,
    locale: SupportedLocale,
  ): Promise<AddressView> {
    const now = clock.now();
    const row = await runInTransaction(
      async (tx) => {
        await lockCustomer(tx, customerId);
        const count = await tx.customerAddress.count({ where: { customerId } });
        if (count >= MAX_ADDRESSES) {
          throw conflict(`You can save up to ${MAX_ADDRESSES} addresses.`, {
            reason: "ADDRESS_LIMIT_REACHED",
            limit: MAX_ADDRESSES,
          });
        }
        await findUsableArea(tx, input.areaId);
        return tx.customerAddress.create({
          data: {
            ...input,
            customerId,
            isDefault: count === 0,
            createdAt: now,
            updatedAt: now,
          },
          include: WITH_AREA,
        });
      },
      {},
      db,
    );
    return toView(row, locale);
  }

  async function updateAddress(
    customerId: string,
    addressId: string,
    input: UpdateAddressInput,
    locale: SupportedLocale,
  ): Promise<AddressView> {
    const now = clock.now();
    const row = await runInTransaction(
      async (tx) => {
        await lockCustomer(tx, customerId);
        const existing = await findOwn(tx, customerId, addressId);
        // Keeping an area that was deactivated since is fine; moving to one is not.
        if (input.areaId !== undefined && input.areaId !== existing.areaId) {
          await findUsableArea(tx, input.areaId);
        }
        return tx.customerAddress.update({
          where: { id: addressId },
          data: { ...input, updatedAt: now },
          include: WITH_AREA,
        });
      },
      {},
      db,
    );
    return toView(row, locale);
  }

  async function deleteAddress(customerId: string, addressId: string): Promise<void> {
    await runInTransaction(
      async (tx) => {
        await lockCustomer(tx, customerId);
        const existing = await findOwn(tx, customerId, addressId);
        await tx.customerAddress.delete({ where: { id: addressId } });
        if (existing.isDefault) {
          const next = await tx.customerAddress.findFirst({
            where: { customerId },
            orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
          });
          if (next) {
            await tx.customerAddress.update({ where: { id: next.id }, data: { isDefault: true } });
          }
        }
      },
      {},
      db,
    );
  }

  async function setDefaultAddress(
    customerId: string,
    addressId: string,
    locale: SupportedLocale,
  ): Promise<AddressView> {
    const row = await runInTransaction(
      async (tx) => {
        await lockCustomer(tx, customerId);
        await findOwn(tx, customerId, addressId);
        await tx.customerAddress.updateMany({
          where: { customerId, isDefault: true, NOT: { id: addressId } },
          data: { isDefault: false },
        });
        return tx.customerAddress.update({
          where: { id: addressId },
          data: { isDefault: true },
          include: WITH_AREA,
        });
      },
      {},
      db,
    );
    return toView(row, locale);
  }

  return { listAddresses, createAddress, updateAddress, deleteAddress, setDefaultAddress };
}

export type AddressesService = ReturnType<typeof createAddressesService>;

let defaultService: AddressesService | undefined;

export function getAddressesService(): AddressesService {
  defaultService ??= createAddressesService({ db: getDb(), clock: systemClock });
  return defaultService;
}
