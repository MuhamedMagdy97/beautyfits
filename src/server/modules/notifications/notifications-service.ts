import type {
  Locale,
  NotificationChannel,
  NotificationDeliveryStatus,
  NotificationType,
  OutboxEvent,
  Prisma,
  PrismaClient,
} from "@/generated/prisma/client";
import { getEnv } from "@/server/config/env";
import { getDb } from "@/server/db/client";
import type { Db } from "@/server/db/transaction";
import { getEmailSender, type EmailSender } from "@/server/email/email";
import { AppError } from "@/server/errors/app-error";
import type { Pagination } from "@/server/http/response";
import { logger as rootLogger, type Logger } from "@/server/logging/logger";
import { localName } from "@/server/modules/locations/locations-service";
import {
  marketingConsentChannels,
  type MarketingConsentLookup,
} from "@/server/modules/notifications/marketing-consent";
import {
  NOTIFICATION_TEMPLATES,
  TEMPLATE_KEYS,
  codConfirmationLink,
  eligibleChannels,
  isTemplateKey,
  productLink,
  type TemplateVars,
} from "@/server/modules/notifications/templates";
import type {
  ListDeliveriesQuery,
  ListNotificationsQuery,
} from "@/server/modules/notifications/schemas";
import { createCodService } from "@/server/modules/orders/cod-service";
import { orderContacts } from "@/server/modules/orders/contacts";
import type { PermissionSet } from "@/server/modules/rbac/authorization";
import { MS_PER_MINUTE, systemClock, type Clock } from "@/server/time/time";
import { getWhatsAppSender, type WhatsAppSender } from "@/server/whatsapp/whatsapp";

/**
 * Notification service (TASK-045, ADR-0043; Business Spec Q53, Q55–Q58, Q61,
 * Q63; User Flows §16.1; Architecture §12).
 *
 * - In-app centre for customers and staff: list, read, read all (Q58).
 *   Notifications are kept (history).
 * - `dispatchPending` (job `jobs:dispatch-notifications`) turns committed
 *   outbox events into messages after commit: the in-app notification, then
 *   the first eligible channel (WhatsApp), then the fallback (email) only when
 *   the recipient has an authorized address for it. Every attempt is one
 *   `notification_deliveries` row. An event whose message is already sent is
 *   never sent again; one with no channel left is retried later.
 */

/** A claimed event is re-claimable after this (a crashed run). */
export const DISPATCH_LEASE_MS = 15 * MS_PER_MINUTE;
/** Runs per event before it is marked FAILED. */
export const DISPATCH_MAX_ATTEMPTS = 5;
/** Wait before the next run: attempt × this. */
export const DISPATCH_RETRY_STEP_MS = 5 * MS_PER_MINUTE;
const BATCH_SIZE = 100;

export interface NotificationView {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  deepLink: { type: string; id: string } | null;
  readAt: string | null;
  createdAt: string;
}

export interface DeliveryView {
  id: string;
  notificationId: string | null;
  orderId: string | null;
  templateKey: string;
  locale: string;
  channel: string;
  /** Only with `VIEW_CUSTOMER_CONTACT`. */
  recipient?: string;
  attemptNumber: number;
  status: NotificationDeliveryStatus;
  providerReference: string | null;
  failureReason: string | null;
  createdAt: string;
  sentAt: string | null;
}

export type Owner = { customerId: string } | { employeeId: string };

type NotificationRow = Prisma.NotificationGetPayload<object>;

function toView(row: NotificationRow): NotificationView {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    deepLink:
      row.deepLinkType && row.deepLinkId ? { type: row.deepLinkType, id: row.deepLinkId } : null,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function ownerWhere(owner: Owner): Prisma.NotificationWhereInput {
  return "customerId" in owner
    ? { recipientType: "CUSTOMER", customerId: owner.customerId }
    : { recipientType: "EMPLOYEE", employeeId: owner.employeeId };
}

function pagination(query: { page: number; pageSize: number }, total: number): Pagination {
  return {
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.ceil(total / query.pageSize),
  };
}

function notificationNotFound(): AppError {
  return new AppError("NOT_FOUND", "Notification not found.");
}

/**
 * Adds an in-app notification in the caller's transaction, e.g. a staff
 * notification for low stock (Q110). Customers or employees only; guests have
 * no notification centre.
 */
export async function createNotification(
  tx: Db,
  input: Owner & {
    type: NotificationType;
    title: string;
    body: string;
    deepLink?: { type: string; id: string };
    now: Date;
  },
): Promise<string> {
  const row = await tx.notification.create({
    data: {
      ...("customerId" in input
        ? { recipientType: "CUSTOMER", customerId: input.customerId }
        : { recipientType: "EMPLOYEE", employeeId: input.employeeId }),
      type: input.type,
      title: input.title,
      body: input.body,
      deepLinkType: input.deepLink?.type ?? null,
      deepLinkId: input.deepLink?.id ?? null,
      createdAt: input.now,
    },
  });
  return row.id;
}

const RECIPIENT_CUSTOMER = {
  id: true,
  phone: true,
  preferredLocale: true,
  anonymizedAt: true,
  account: { select: { email: true, emailVerifiedAt: true } },
} as const;

const RECIPIENT_VARIANT = {
  variantNameAr: true,
  variantNameEn: true,
  product: { select: { id: true, nameAr: true, nameEn: true, slug: true } },
} as const;

type RecipientCustomer = Prisma.CustomerGetPayload<{ select: typeof RECIPIENT_CUSTOMER }>;
type RecipientVariant = Prisma.ProductVariantGetPayload<{ select: typeof RECIPIENT_VARIANT }>;

/** Who receives an event's message: authorized addresses only (ADR-0043 §3). */
interface Recipient {
  customerId: string | null;
  orderId: string | null;
  locale: Locale;
  phone: string | null;
  email: string | null;
  vars: TemplateVars;
  notificationType: NotificationType;
  deepLink: { type: string; id: string };
}

/** Why an event cannot be delivered now; the job retries it later. */
class DeliveryFailed extends Error {}

export function createNotificationsService(deps: {
  db: PrismaClient;
  clock: Clock;
  email?: EmailSender;
  whatsapp?: WhatsAppSender;
  websiteUrl?: () => string;
  logger?: Logger;
  /** TASK-046 seam (wishlist reminders, R6). */
  marketingConsent?: MarketingConsentLookup;
}) {
  const { db, clock } = deps;
  const marketingConsent = deps.marketingConsent ?? marketingConsentChannels;
  const email = () => deps.email ?? getEmailSender();
  const whatsapp = () => deps.whatsapp ?? getWhatsAppSender();
  const websiteUrl = deps.websiteUrl ?? (() => getEnv().WEBSITE_URL);
  const log = deps.logger ?? rootLogger;
  const cod = createCodService({ db, clock });

  // ---- In-app centre (Q58) -------------------------------------------------

  async function list(owner: Owner, query: ListNotificationsQuery) {
    const where: Prisma.NotificationWhereInput = {
      ...ownerWhere(owner),
      ...(query.unread ? { readAt: null } : {}),
    };
    const [total, rows] = await Promise.all([
      db.notification.count({ where }),
      db.notification.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return { items: rows.map(toView), pagination: pagination(query, total) };
  }

  /** Marks one as read; reading it again keeps the first time. Others' are 404. */
  async function markRead(owner: Owner, id: string): Promise<NotificationView> {
    const now = clock.now();
    const where = { id, ...ownerWhere(owner) };
    await db.notification.updateMany({ where: { ...where, readAt: null }, data: { readAt: now } });
    const row = await db.notification.findFirst({ where });
    if (!row) {
      throw notificationNotFound();
    }
    return toView(row);
  }

  async function markAllRead(owner: Owner): Promise<{ updated: number }> {
    const { count } = await db.notification.updateMany({
      where: { ...ownerWhere(owner), readAt: null },
      data: { readAt: clock.now() },
    });
    return { updated: count };
  }

  // ---- Delivery log (`NOTIFICATION_LOG_VIEW`) --------------------------------

  async function listDeliveries(query: ListDeliveriesQuery, permissions: PermissionSet) {
    const contact = permissions.has("VIEW_CUSTOMER_CONTACT");
    const where: Prisma.NotificationDeliveryWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.channel ? { channel: query.channel } : {}),
      ...(query.orderId ? { orderId: query.orderId } : {}),
    };
    const [total, rows] = await Promise.all([
      db.notificationDelivery.count({ where }),
      db.notificationDelivery.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    const items: DeliveryView[] = rows.map((row) => ({
      id: row.id,
      notificationId: row.notificationId,
      orderId: row.orderId,
      templateKey: row.templateKey,
      locale: row.locale,
      channel: row.channel,
      ...(contact ? { recipient: row.recipient } : {}),
      attemptNumber: row.attemptNumber,
      status: row.status,
      providerReference: row.providerReference,
      failureReason: row.failureReason,
      createdAt: row.createdAt.toISOString(),
      sentAt: row.sentAt?.toISOString() ?? null,
    }));
    return { items, pagination: pagination(query, total) };
  }

  // ---- Dispatch (outbox → messages, after commit) ----------------------------

  /** A customer's authorized addresses, limited to the allowed channels. */
  function customerRecipient(
    customer: RecipientCustomer,
    variant: RecipientVariant,
    notificationType: NotificationType,
    allowed: readonly NotificationChannel[],
  ): Recipient | null {
    if (customer.anonymizedAt) {
      return null; // Q154: a deactivated profile is wiped.
    }
    const locale = customer.preferredLocale;
    const { product } = variant;
    const variantName = locale === "ar" ? variant.variantNameAr : variant.variantNameEn;
    const account = customer.account;
    return {
      customerId: customer.id,
      orderId: null,
      locale,
      phone: allowed.includes("WHATSAPP") ? customer.phone : null,
      email: allowed.includes("EMAIL") && account?.emailVerifiedAt ? account.email : null,
      vars: {
        productName: localName(product, locale) + (variantName ? ` (${variantName})` : ""),
        link: productLink(websiteUrl(), product.slug),
      },
      notificationType,
      deepLink: { type: "PRODUCT", id: product.id },
    };
  }

  /** Who gets the event's message, and where; null when nobody (any more). */
  async function recipientOf(event: OutboxEvent): Promise<Recipient | null> {
    if (event.eventType === "RESTOCK_AVAILABLE") {
      // TASK-043, Q52/Q62: the channels the customer chose on the subscription.
      const subscription = await db.restockSubscription.findUnique({
        where: { id: event.aggregateId },
        select: {
          emailEnabled: true,
          whatsappEnabled: true,
          customer: { select: RECIPIENT_CUSTOMER },
          variant: { select: RECIPIENT_VARIANT },
        },
      });
      if (!subscription) return null;
      const allowed: NotificationChannel[] = [
        ...(subscription.whatsappEnabled ? (["WHATSAPP"] as const) : []),
        ...(subscription.emailEnabled ? (["EMAIL"] as const) : []),
      ];
      return customerRecipient(subscription.customer, subscription.variant, "RESTOCK", allowed);
    }
    if (event.eventType === "WISHLIST_REMINDER") {
      // TASK-043, R6: only channels with marketing consent, checked again at send time.
      const item = await db.wishlistItem.findUnique({
        where: { id: event.aggregateId },
        select: {
          wishlist: { select: { customer: { select: RECIPIENT_CUSTOMER } } },
          variant: { select: RECIPIENT_VARIANT },
        },
      });
      if (!item) return null; // Removed from the wishlist since.
      const customer = item.wishlist.customer;
      const allowed = await marketingConsent(db, customer.id);
      return customerRecipient(customer, item.variant, "MARKETING", allowed);
    }
    const order = await orderContacts(db, event.aggregateId);
    if (!order) return null; // Q154: a deactivated profile is wiped.
    return {
      customerId: order.customerId,
      orderId: order.orderId,
      locale: order.locale,
      phone: order.phone,
      email: order.email,
      vars: { orderNumber: order.orderNumber },
      notificationType: "TRANSACTIONAL",
      deepLink: { type: "ORDER", id: order.orderId },
    };
  }

  /** One message for one event. Returns normally when nothing is left to do. */
  async function deliver(event: OutboxEvent): Promise<void> {
    const key = event.eventType;
    if (!isTemplateKey(key)) return;
    const template = NOTIFICATION_TEMPLATES[key];
    const target = await recipientOf(event);
    if (!target) {
      return; // Nobody to tell.
    }
    const { locale, vars } = target;

    // In-app first: one per event (unique source_event_id), customers only.
    let notificationId: string | null = null;
    if (template.inApp && target.customerId) {
      const message = template.render(locale, vars);
      await db.notification.createMany({
        data: [
          {
            recipientType: "CUSTOMER",
            customerId: target.customerId,
            type: target.notificationType,
            title: message.title,
            body: message.text,
            deepLinkType: target.deepLink.type,
            deepLinkId: target.deepLink.id,
            sourceEventId: event.id,
            createdAt: clock.now(),
          },
        ],
        skipDuplicates: true,
      });
      notificationId =
        (await db.notification.findUnique({ where: { sourceEventId: event.id } }))?.id ?? null;
    }

    const attempts = await db.notificationDelivery.findMany({
      where: { sourceEventId: event.id },
      select: { status: true },
    });
    if (attempts.some((a) => a.status === "SENT" || a.status === "FALLBACK_SENT")) {
      return; // Already delivered: never send twice.
    }

    // Authorized channels only (Q61): a customer's verified email; the guest's own contacts.
    const channels = eligibleChannels(template, target);
    if (channels.length === 0) {
      log.warn("notification has no eligible channel", { eventId: event.id, templateKey: key });
      return;
    }

    let link = vars.link;
    if (template.codLink && target.orderId) {
      try {
        const { token } = await cod.issueConfirmationToken(target.orderId);
        link = codConfirmationLink(websiteUrl(), target.orderId, token);
      } catch (error) {
        if (error instanceof AppError && error.code === "ORDER_STATE_INVALID") {
          return; // Confirmed, cancelled or past its deadline: nothing to ask.
        }
        throw error;
      }
    }
    const message = template.render(locale, { ...vars, link });

    let attemptNumber = attempts.length;
    let failedBefore = false;
    for (const { channel, recipient } of channels) {
      attemptNumber += 1;
      const delivery = await db.notificationDelivery.create({
        data: {
          notificationId,
          sourceEventId: event.id,
          orderId: target.orderId,
          templateKey: key,
          locale,
          channel,
          recipient,
          attemptNumber,
          status: "PENDING",
          createdAt: clock.now(),
        },
      });
      try {
        let reference: string | null = null;
        if (channel === "WHATSAPP") {
          reference = (await whatsapp().send({ to: recipient, text: message.text })).reference;
        } else {
          await email().send({ to: recipient, subject: message.title, text: message.text });
        }
        await db.notificationDelivery.update({
          where: { id: delivery.id },
          data: {
            status: failedBefore ? "FALLBACK_SENT" : "SENT",
            providerReference: reference,
            sentAt: clock.now(),
          },
        });
        log.info("notification sent", { eventId: event.id, templateKey: key, channel });
        return;
      } catch (error) {
        failedBefore = true;
        await db.notificationDelivery.update({
          where: { id: delivery.id },
          data: { status: "FAILED", failureReason: reasonOf(error) },
        });
        log.warn("notification attempt failed", { eventId: event.id, templateKey: key, channel });
      }
    }
    throw new DeliveryFailed("every eligible channel failed");
  }

  /**
   * Delivers the due notification events once. Safe to run at any time and
   * from several processes: each event is claimed with a conditional update.
   */
  async function dispatchPending(): Promise<{ done: number; retried: number; failed: number }> {
    const now = clock.now();
    const due = await db.outboxEvent.findMany({
      where: {
        eventType: { in: TEMPLATE_KEYS },
        status: { in: ["PENDING", "PROCESSING"] },
        availableAt: { lte: now },
      },
      orderBy: [{ availableAt: "asc" }, { id: "asc" }],
      take: BATCH_SIZE,
    });
    const result = { done: 0, retried: 0, failed: 0 };
    for (const event of due) {
      const attempt = event.attemptCount + 1;
      const { count } = await db.outboxEvent.updateMany({
        where: { id: event.id, status: event.status, attemptCount: event.attemptCount },
        data: {
          status: "PROCESSING",
          attemptCount: attempt,
          availableAt: new Date(now.getTime() + DISPATCH_LEASE_MS),
        },
      });
      if (count === 0) continue; // Another run has it.
      try {
        await deliver(event);
        await db.outboxEvent.update({
          where: { id: event.id },
          data: { status: "DONE", processedAt: clock.now(), lastError: null },
        });
        result.done += 1;
      } catch (error) {
        const final = attempt >= DISPATCH_MAX_ATTEMPTS;
        await db.outboxEvent.update({
          where: { id: event.id },
          data: {
            status: final ? "FAILED" : "PENDING",
            availableAt: new Date(clock.now().getTime() + attempt * DISPATCH_RETRY_STEP_MS),
            lastError: reasonOf(error),
          },
        });
        if (final) result.failed += 1;
        else result.retried += 1;
        if (!(error instanceof DeliveryFailed)) {
          log.error("notification dispatch error", { eventId: event.id, error: reasonOf(error) });
        }
      }
    }
    return result;
  }

  return { list, markRead, markAllRead, listDeliveries, dispatchPending };
}

/** Short, single-line failure text for the logs (no message content). */
function reasonOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/\s+/g, " ").slice(0, 500);
}

export type NotificationsService = ReturnType<typeof createNotificationsService>;

let defaultService: NotificationsService | undefined;

export function getNotificationsService(): NotificationsService {
  defaultService ??= createNotificationsService({ db: getDb(), clock: systemClock });
  return defaultService;
}
