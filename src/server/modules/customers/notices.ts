import type { Locale } from "@/generated/prisma/client";
import type { EmailMessage } from "@/server/email/email";

/**
 * Security notices sent after an identity change commits (Q152, R30). They
 * never contain the new email or phone in full.
 */

export type ChangeNotice = "EMAIL_CHANGED" | "PHONE_CHANGED";

const TEMPLATES: Record<ChangeNotice, Record<Locale, { subject: string; text: string }>> = {
  EMAIL_CHANGED: {
    en: {
      subject: "Your BeautyFits email was changed",
      text:
        "The email address of your BeautyFits account was just changed, so this address no longer signs in.\n\n" +
        "If you did not make this change, contact BeautyFits support right away.\n",
    },
    ar: {
      subject: "تم تغيير بريدك الإلكتروني في BeautyFits",
      text:
        "تم تغيير البريد الإلكتروني لحسابك في BeautyFits الآن، ولم يعد هذا البريد يُستخدم لتسجيل الدخول.\n\n" +
        "إذا لم تقم بهذا التغيير، تواصل مع دعم BeautyFits فورًا.\n",
    },
  },
  PHONE_CHANGED: {
    en: {
      subject: "Your BeautyFits phone number was changed",
      text:
        "The phone number of your BeautyFits account was just changed.\n\n" +
        "If you did not make this change, change your password and contact BeautyFits support right away.\n",
    },
    ar: {
      subject: "تم تغيير رقم هاتفك في BeautyFits",
      text:
        "تم تغيير رقم الهاتف لحسابك في BeautyFits الآن.\n\n" +
        "إذا لم تقم بهذا التغيير، غيّر كلمة المرور وتواصل مع دعم BeautyFits فورًا.\n",
    },
  },
};

export function changeNoticeEmail(notice: ChangeNotice, locale: Locale, to: string): EmailMessage {
  return { to, ...TEMPLATES[notice][locale] };
}
