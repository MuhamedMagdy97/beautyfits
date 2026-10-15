import type { AccountStatus, Prisma, PrismaClient } from "@/generated/prisma/client";
import { getDb } from "@/server/db/client";
import { AppError } from "@/server/errors/app-error";
import type { SupportedLocale } from "@/server/http/locale";
import type { Pagination } from "@/server/http/response";
import {
  toView as toAddressView,
  WITH_AREA,
  type AddressView,
} from "@/server/modules/customers/addresses-service";
import type { ListCustomersQuery } from "@/server/modules/customers/schemas";
import {
  createOrdersService,
  type OrderListItemView,
} from "@/server/modules/orders/orders-service";
import { permissionDenied, type PermissionSet } from "@/server/modules/rbac/authorization";
import { systemClock, type Clock } from "@/server/time/time";

/**
 * Staff reads of customers (TASK-054, API "TASK-002A Amendments", Q80,
 * ADR-0063). `CUSTOMER_VIEW` shows the name, account state and order
 * history; phone, email and addresses need `VIEW_CUSTOMER_CONTACT`, as on
 * orders (ADR-0036). Date of birth is never shown.
 */

/** Orders listed on the customer detail, newest first; the rest are in the order list. */
export const CUSTOMER_RECENT_ORDERS = 20;

export interface AdminCustomerListItem {
  id: string;
  fullName: string;
  /** `null` for a customer without an account. */
  accountStatus: AccountStatus | null;
  anonymized: boolean;
  orderCount: number;
  createdAt: string;
  /** Only with `VIEW_CUSTOMER_CONTACT`. */
  phone?: string;
  email?: string | null;
}

export interface AdminCustomerView extends AdminCustomerListItem {
  preferredLocale: string;
  phoneVerified: boolean;
  emailVerified: boolean;
  anonymizedAt: string | null;
  /** Only with `VIEW_CUSTOMER_CONTACT`. */
  addresses?: AddressView[];
  /** The latest orders (at most `CUSTOMER_RECENT_ORDERS`); `orderCount` has the total. */
  orders: OrderListItemView[];
}

const ROW = {
  account: { select: { email: true, emailVerifiedAt: true, status: true } },
  _count: { select: { orders: true } },
} as const satisfies Prisma.CustomerInclude;

type Row = Prisma.CustomerGetPayload<{ include: typeof ROW }>;

function toListItem(row: Row, contact: boolean): AdminCustomerListItem {
  return {
    id: row.id,
    fullName: row.fullName,
    accountStatus: row.account?.status ?? null,
    anonymized: row.anonymizedAt !== null,
    orderCount: row._count.orders,
    createdAt: row.createdAt.toISOString(),
    ...(contact ? { phone: row.phone, email: row.account?.email ?? null } : {}),
  };
}

export function createAdminCustomersService(deps: { db: PrismaClient; clock: Clock }) {
  const { db } = deps;
  const orders = createOrdersService(deps);

  /** `GET /admin/customers`: newest first; the `phone` filter needs contact access. */
  async function listCustomers(
    query: ListCustomersQuery,
    permissions: PermissionSet,
  ): Promise<{ items: AdminCustomerListItem[]; pagination: Pagination }> {
    const contact = permissions.has("VIEW_CUSTOMER_CONTACT");
    if (query.phone && !contact) {
      throw permissionDenied("Searching by phone needs VIEW_CUSTOMER_CONTACT.", {
        requiredPermissions: ["VIEW_CUSTOMER_CONTACT"],
      });
    }
    const where: Prisma.CustomerWhereInput = {
      ...(query.search ? { fullName: { contains: query.search, mode: "insensitive" } } : {}),
      ...(query.phone ? { phone: query.phone } : {}),
    };
    const [count, rows] = await Promise.all([
      db.customer.count({ where }),
      db.customer.findMany({
        where,
        include: ROW,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      items: rows.map((row) => toListItem(row, contact)),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total: count,
        totalPages: Math.ceil(count / query.pageSize),
      },
    };
  }

  /** `GET /admin/customers/{id}`. */
  async function getCustomer(
    customerId: string,
    permissions: PermissionSet,
    locale: SupportedLocale,
  ): Promise<AdminCustomerView> {
    const contact = permissions.has("VIEW_CUSTOMER_CONTACT");
    const row = await db.customer.findUnique({ where: { id: customerId }, include: ROW });
    if (!row) {
      throw new AppError("NOT_FOUND", "Customer not found.");
    }
    const [recent, addresses] = await Promise.all([
      orders.listMyOrders(customerId, { page: 1, pageSize: CUSTOMER_RECENT_ORDERS }),
      // Contact data is not even read without VIEW_CUSTOMER_CONTACT (Q80).
      contact
        ? db.customerAddress.findMany({
            where: { customerId },
            include: WITH_AREA,
            orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
          })
        : null,
    ]);
    return {
      ...toListItem(row, contact),
      preferredLocale: row.preferredLocale,
      phoneVerified: row.phoneVerifiedAt !== null,
      emailVerified: Boolean(row.account?.emailVerifiedAt),
      anonymizedAt: row.anonymizedAt?.toISOString() ?? null,
      ...(addresses ? { addresses: addresses.map((a) => toAddressView(a, locale)) } : {}),
      orders: recent.items,
    };
  }

  return { listCustomers, getCustomer };
}

export type AdminCustomersService = ReturnType<typeof createAdminCustomersService>;

let defaultService: AdminCustomersService | undefined;

export function getAdminCustomersService(): AdminCustomersService {
  defaultService ??= createAdminCustomersService({ db: getDb(), clock: systemClock });
  return defaultService;
}
