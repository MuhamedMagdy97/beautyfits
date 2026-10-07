import type { NotificationChannel } from "@/generated/prisma/client";
import type { SupportedLocale } from "@/server/http/locale";

/**
 * Transactional notification templates (TASK-045, ADR-0043; Business Spec
 * Q53, Q55, Q56, Q57, Q61, Q63, R14, R39).
 *
 * One template per outbox event the notification service handles. The
 * channel list is the policy (Q63): the first eligible channel is tried
 * first and the next one is the fallback (Q61: WhatsApp primary, email
 * fallback). Transactional messages cannot be switched off (Q53).
 */

export interface TemplateVars {
  orderNumber: string;
  /** The COD secure link; only for the COD templates. */
  link?: string;
}

export interface RenderedMessage {
  title: string;
  text: string;
}

export interface NotificationTemplate {
  /** Ordered: primary first, then the fallback. */
  channels: readonly NotificationChannel[];
  /** Also shown in the customer's in-app centre (customers only, Q57). */
  inApp: boolean;
  /** Needs a COD confirmation link (ADR-0037 §3). */
  codLink: boolean;
  render(locale: SupportedLocale, vars: TemplateVars): RenderedMessage;
}

const PRIMARY_WITH_FALLBACK = ["WHATSAPP", "EMAIL"] as const;

export const NOTIFICATION_TEMPLATES = {
  ORDER_CREATED: {
    channels: PRIMARY_WITH_FALLBACK,
    inApp: true,
    codLink: false,
    render: (locale, { orderNumber }) =>
      locale === "ar"
        ? {
            title: "تم استلام طلبك",
            text: `استلمنا طلبك رقم ${orderNumber}. شكراً لتسوقك من BeautyFits.`,
          }
        : {
            title: "Order received",
            text: `We received your order ${orderNumber}. Thank you for shopping with BeautyFits.`,
          },
  },
  // R39: the COD request and reminders go on WhatsApp only; the link
  // confirmation source is WHATSAPP (R10), so there is no email fallback.
  COD_CONFIRMATION_REQUESTED: {
    channels: ["WHATSAPP"],
    inApp: false,
    codLink: true,
    render: (locale, { orderNumber, link }) =>
      locale === "ar"
        ? {
            title: "أكد طلبك",
            text: `من فضلك أكد طلبك رقم ${orderNumber} للدفع عند الاستلام: ${link}`,
          }
        : {
            title: "Confirm your order",
            text: `Please confirm your cash-on-delivery order ${orderNumber}: ${link}`,
          },
  },
  COD_CONFIRMATION_REMINDER: {
    channels: ["WHATSAPP"],
    inApp: false,
    codLink: true,
    render: (locale, { orderNumber, link }) =>
      locale === "ar"
        ? {
            title: "تذكير بتأكيد طلبك",
            text: `طلبك رقم ${orderNumber} ما زال في انتظار تأكيدك: ${link}`,
          }
        : {
            title: "Reminder: confirm your order",
            text: `Your order ${orderNumber} is still waiting for your confirmation: ${link}`,
          },
  },
  ORDER_COD_CONFIRMED: {
    channels: PRIMARY_WITH_FALLBACK,
    inApp: true,
    codLink: false,
    render: (locale, { orderNumber }) =>
      locale === "ar"
        ? { title: "تم تأكيد طلبك", text: `شكراً، تم تأكيد طلبك رقم ${orderNumber}.` }
        : { title: "Order confirmed", text: `Thank you, your order ${orderNumber} is confirmed.` },
  },
  ORDER_CONFIRMED: {
    channels: PRIMARY_WITH_FALLBACK,
    inApp: true,
    codLink: false,
    render: (locale, { orderNumber }) =>
      locale === "ar"
        ? { title: "تم قبول طلبك", text: `تمت مراجعة طلبك رقم ${orderNumber} وسيتم تجهيزه.` }
        : {
            title: "Order accepted",
            text: `Your order ${orderNumber} has been reviewed and will be prepared.`,
          },
  },
  ORDER_EXPIRED: {
    channels: PRIMARY_WITH_FALLBACK,
    inApp: true,
    codLink: false,
    render: (locale, { orderNumber }) =>
      locale === "ar"
        ? {
            title: "انتهت مهلة تأكيد طلبك",
            text: `انتهت مهلة تأكيد طلبك رقم ${orderNumber} وانتهت صلاحيته.`,
          }
        : {
            title: "Order expired",
            text: `Your order ${orderNumber} was not confirmed in time and has expired.`,
          },
  },
} satisfies Record<string, NotificationTemplate>;

export type TemplateKey = keyof typeof NOTIFICATION_TEMPLATES;

export const TEMPLATE_KEYS = Object.keys(NOTIFICATION_TEMPLATES) as TemplateKey[];

export function isTemplateKey(value: string): value is TemplateKey {
  return Object.hasOwn(NOTIFICATION_TEMPLATES, value);
}

/** Where the customer opens the COD link (ADR-0043): the token stays in the fragment. */
export function codConfirmationLink(websiteUrl: string, orderId: string, token: string): string {
  return `${websiteUrl}/orders/${orderId}/confirm-cod#token=${token}`;
}

/** The channels to try, in order, given the recipient's contacts (Q61, "authorized" fallback). */
export function eligibleChannels(
  template: Pick<NotificationTemplate, "channels">,
  contacts: { phone: string | null; email: string | null },
): { channel: NotificationChannel; recipient: string }[] {
  return template.channels.flatMap((channel) => {
    const recipient = channel === "WHATSAPP" ? contacts.phone : contacts.email;
    return recipient ? [{ channel, recipient }] : [];
  });
}
