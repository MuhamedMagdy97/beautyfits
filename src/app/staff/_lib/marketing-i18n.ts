import { StaffApiError } from "./api";
import { DICTIONARIES, errorMessage, useT, type Dictionary } from "./i18n";
import { formatPiastres } from "./money";

/**
 * Discounts, marketing, wallet and notification-log screen texts (TASK-056),
 * Arabic and English (R14). Kept apart from the shell dictionary so feature
 * screens do not edit it.
 */

const en = {
  none: "—",
  all: "All",
  refresh: "Refresh",
  search: "Search",
  apply: "Apply",
  save: "Save",
  cancel: "Cancel",
  edit: "Edit",
  open: "Open",
  create: "Create",
  remove: "Remove",
  saved: "Saved.",
  empty: "Nothing to show.",
  status: "Status",
  created: "Created",
  name: "Name",
  reasonOptional: "Reason (optional)",
  reasonRequired: "Reason (required)",
  // Discounts
  newDiscount: "New discount",
  editDiscount: "Edit discount",
  discountsIntro:
    "Percentage discounts with a code, or offers shown in the cart without a code. New discounts start inactive.",
  searchDiscounts: "Code or name",
  code: "Code",
  codeHint: "Leave blank for an offer shown in the cart without a code.",
  noCode: "Offer (no code)",
  nameAr: "Arabic name",
  nameEn: "English name",
  percent: "Discount (%)",
  scope: "Applies to",
  scopes: {
    STORE_WIDE: "The whole store",
    TARGETED: "Chosen products, categories or brands",
  } as Record<string, string>,
  maxDiscount: "Maximum discount (EGP, optional)",
  minimumOrder: "Minimum order total (EGP, optional)",
  startsAt: "Starts",
  endsAt: "Ends (optional)",
  usageTotal: "Uses in total (optional)",
  usagePerCustomer: "Uses per customer (optional)",
  used: "Used",
  period: "Period",
  activate: "Activate",
  deactivate: "Deactivate",
  discountStatuses: { ACTIVE: "Active", INACTIVE: "Inactive" } as Record<string, string>,
  products: "Products",
  categories: "Categories",
  brands: "Brands",
  searchProducts: "Search products by name or SKU",
  chosen: "{n} chosen",
  badAmount: "Type an amount in pounds, e.g. 25 or 25.50.",
  badDate: "Choose a start date.",
  // Marketing
  campaigns: "Campaigns",
  newCampaign: "New campaign",
  campaignIntro:
    "Campaigns go to customers who opted in to the channel. Each campaign needs approval by an Owner or Admin before it can be sent.",
  channel: "Channel",
  channels: { EMAIL: "Email", WHATSAPP: "WhatsApp" } as Record<string, string>,
  segment: "Audience",
  segmentTypes: {
    ALL_OPTED_IN: "Everyone opted in",
    PREVIOUS_BUYERS: "Previous buyers",
    PRODUCT_BUYERS: "Buyers of chosen products",
    BRAND_BUYERS: "Buyers of chosen brands",
    CATEGORY_BUYERS: "Buyers of chosen categories",
    INACTIVE: "Inactive buyers",
    HIGH_SPENDING: "High-spending customers",
  } as Record<string, string>,
  inactiveDays: "No order in the last (days)",
  minSpent: "Spent at least (EGP)",
  audience: "Customers opted in now: {n}",
  audienceIncomplete: "Complete the audience to see how many customers it reaches.",
  subject: "Email subject",
  content: "Message (plain text)",
  campaignStatuses: {
    DRAFT: "Draft",
    PENDING_APPROVAL: "Waiting for approval",
    APPROVED: "Approved",
    SENDING: "Sending",
    COMPLETED: "Completed",
    FAILED: "Failed",
    CANCELLED: "Cancelled",
  } as Record<string, string>,
  createdBy: "Created by",
  approvedBy: "Approved by",
  sentBy: "Sent by",
  submit: "Submit for approval",
  approve: "Approve",
  reject: "Reject",
  send: "Send",
  sendConfirm:
    "Send this campaign? The customers opted in right now become its recipients. This cannot be undone.",
  recipients: "Recipients",
  recipientStatuses: {
    PENDING: "Waiting",
    SENT: "Sent",
    FALLBACK_SENT: "Sent by email fallback",
    FAILED: "Failed",
    SKIPPED: "Skipped",
  },
  skipReasons: {
    CONSENT_WITHDRAWN: "opted out",
    FREQUENCY_LIMIT: "frequency limit",
    NO_ADDRESS: "no address",
  },
  lastRejection: "Rejected: {reason}",
  history: "History",
  ownSubmission: "You submitted this campaign; another Owner or Admin must approve it.",
  submitted: "Submitted for approval.",
  approved: "Approved.",
  rejected: "Rejected and returned to draft.",
  sendingStarted: "Sending started.",
  backToCampaigns: "All campaigns",
  // Wallet
  walletIntro:
    "Look up a customer's wallet by customer id (open it from the customer's page). Manual adjustments are for Owners and Admins and always need a reason.",
  customerId: "Customer id",
  lookUp: "Look up",
  badCustomerId: "Paste a customer id (a UUID).",
  balance: "Balance",
  reserved: "Held for pending orders",
  available: "Available",
  transactions: "Transactions",
  type: "Type",
  amount: "Amount (EGP)",
  reference: "Reference",
  reason: "Reason",
  walletTypes: {
    MANUAL_ADJUSTMENT: "Manual adjustment",
    ORDER_WALLET_USE: "Used on an order",
    RETURN_REFUND: "Return refund",
    ORDER_CANCELLATION_REFUND: "Cancelled order refund",
  } as Record<string, string>,
  adjust: "Adjust the wallet",
  direction: "Direction",
  directions: { CREDIT: "Credit (add)", DEBIT: "Debit (take away)" } as Record<string, string>,
  adjustConfirm: {
    CREDIT: "Add {amount} EGP to this wallet?",
    DEBIT: "Take {amount} EGP from this wallet?",
  } as Record<string, string>,
  adjusted: "Adjustment recorded.",
  // Notifications
  deliveriesIntro: "Email and WhatsApp delivery attempts and failures.",
  orderId: "Order id",
  template: "Message",
  recipient: "Recipient",
  attempt: "Attempt",
  failure: "Failure",
  providerReference: "Provider reference",
  sentAt: "Sent",
  deliveryStatuses: {
    PENDING: "Pending",
    SENT: "Sent",
    FAILED: "Failed",
    FALLBACK_SENT: "Sent by fallback",
  } as Record<string, string>,
  hiddenContact: "Hidden",
  conflicts: {
    CODE_TAKEN: "Another discount already uses this code.",
    CAMPAIGN_STATUS_INVALID: "The campaign's status changed. Refresh and try again.",
    CAMPAIGN_AUDIENCE_EMPTY: "No customer in this audience is opted in to the channel right now.",
    CUSTOMER_DEACTIVATED: "The customer account is deactivated.",
    SELF_APPROVAL: "You cannot approve your own submission. Another Owner or Admin must do it.",
  } as Record<string, string>,
  conflict: "This conflicts with the current state. Refresh and try again.",
  notFound: "Not found. Check the id and try again.",
  insufficientFunds: "The wallet holds only {n} EGP available.",
  idempotencyConflict: "This adjustment was already sent with different details. Try again.",
};

export type MarketingDictionary = typeof en;

const ar: MarketingDictionary = {
  none: "—",
  all: "الكل",
  refresh: "تحديث",
  search: "بحث",
  apply: "تطبيق",
  save: "حفظ",
  cancel: "إلغاء",
  edit: "تعديل",
  open: "فتح",
  create: "إنشاء",
  remove: "إزالة",
  saved: "تم الحفظ.",
  empty: "لا يوجد ما يُعرض.",
  status: "الحالة",
  created: "تاريخ الإنشاء",
  name: "الاسم",
  reasonOptional: "السبب (اختياري)",
  reasonRequired: "السبب (مطلوب)",
  newDiscount: "خصم جديد",
  editDiscount: "تعديل الخصم",
  discountsIntro:
    "خصومات بنسبة مئوية بكود، أو عروض تظهر في السلة بدون كود. يبدأ الخصم الجديد غير مفعّل.",
  searchDiscounts: "الكود أو الاسم",
  code: "الكود",
  codeHint: "اتركه فارغًا لعرض يظهر في السلة بدون كود.",
  noCode: "عرض (بدون كود)",
  nameAr: "الاسم بالعربية",
  nameEn: "الاسم بالإنجليزية",
  percent: "الخصم (%)",
  scope: "يُطبَّق على",
  scopes: { STORE_WIDE: "المتجر بالكامل", TARGETED: "منتجات أو فئات أو علامات مختارة" },
  maxDiscount: "أقصى خصم (جنيه، اختياري)",
  minimumOrder: "الحد الأدنى للطلب (جنيه، اختياري)",
  startsAt: "يبدأ",
  endsAt: "ينتهي (اختياري)",
  usageTotal: "مرات الاستخدام الإجمالية (اختياري)",
  usagePerCustomer: "مرات الاستخدام لكل عميل (اختياري)",
  used: "مرات الاستخدام",
  period: "المدة",
  activate: "تفعيل",
  deactivate: "إيقاف",
  discountStatuses: { ACTIVE: "مفعّل", INACTIVE: "غير مفعّل" },
  products: "المنتجات",
  categories: "الفئات",
  brands: "العلامات التجارية",
  searchProducts: "ابحث عن منتج بالاسم أو SKU",
  chosen: "تم اختيار {n}",
  badAmount: "اكتب المبلغ بالجنيه، مثل 25 أو 25.50.",
  badDate: "اختر تاريخ البداية.",
  campaigns: "الحملات",
  newCampaign: "حملة جديدة",
  campaignIntro:
    "تُرسل الحملات للعملاء الموافقين على القناة. تحتاج كل حملة إلى موافقة مالك أو مسؤول قبل إرسالها.",
  channel: "القناة",
  channels: { EMAIL: "البريد الإلكتروني", WHATSAPP: "واتساب" },
  segment: "الجمهور",
  segmentTypes: {
    ALL_OPTED_IN: "كل الموافقين",
    PREVIOUS_BUYERS: "من اشتروا من قبل",
    PRODUCT_BUYERS: "مشترو منتجات مختارة",
    BRAND_BUYERS: "مشترو علامات مختارة",
    CATEGORY_BUYERS: "مشترو فئات مختارة",
    INACTIVE: "مشترون غير نشطين",
    HIGH_SPENDING: "العملاء الأعلى إنفاقًا",
  },
  inactiveDays: "بلا طلب خلال آخر (أيام)",
  minSpent: "أنفق على الأقل (جنيه)",
  audience: "العملاء الموافقون الآن: {n}",
  audienceIncomplete: "أكمل تحديد الجمهور لمعرفة عدد العملاء.",
  subject: "عنوان البريد",
  content: "الرسالة (نص عادي)",
  campaignStatuses: {
    DRAFT: "مسودة",
    PENDING_APPROVAL: "بانتظار الموافقة",
    APPROVED: "تمت الموافقة",
    SENDING: "قيد الإرسال",
    COMPLETED: "اكتملت",
    FAILED: "فشلت",
    CANCELLED: "ملغاة",
  },
  createdBy: "أنشأها",
  approvedBy: "وافق عليها",
  sentBy: "أرسلها",
  submit: "إرسال للموافقة",
  approve: "موافقة",
  reject: "رفض",
  send: "إرسال",
  sendConfirm: "إرسال هذه الحملة؟ يصبح العملاء الموافقون الآن هم المستلمين. لا يمكن التراجع.",
  recipients: "المستلمون",
  recipientStatuses: {
    PENDING: "قيد الانتظار",
    SENT: "أُرسلت",
    FALLBACK_SENT: "أُرسلت بالبريد كبديل",
    FAILED: "فشلت",
    SKIPPED: "تم تخطيها",
  },
  skipReasons: {
    CONSENT_WITHDRAWN: "ألغى الموافقة",
    FREQUENCY_LIMIT: "حد التكرار",
    NO_ADDRESS: "لا يوجد عنوان",
  },
  lastRejection: "مرفوضة: {reason}",
  history: "السجل",
  ownSubmission: "أنت من أرسل الحملة للموافقة؛ يجب أن يوافق عليها مالك أو مسؤول آخر.",
  submitted: "أُرسلت للموافقة.",
  approved: "تمت الموافقة.",
  rejected: "رُفضت وأُعيدت إلى المسودة.",
  sendingStarted: "بدأ الإرسال.",
  backToCampaigns: "كل الحملات",
  walletIntro:
    "اعرض محفظة عميل برقم العميل (افتحها من صفحة العميل). التعديلات اليدوية للمالك والمسؤولين فقط وتحتاج دائمًا إلى سبب.",
  customerId: "رقم العميل",
  lookUp: "عرض",
  badCustomerId: "الصق رقم عميل صحيحًا (UUID).",
  balance: "الرصيد",
  reserved: "محجوز لطلبات معلّقة",
  available: "المتاح",
  transactions: "الحركات",
  type: "النوع",
  amount: "المبلغ (جنيه)",
  reference: "المرجع",
  reason: "السبب",
  walletTypes: {
    MANUAL_ADJUSTMENT: "تعديل يدوي",
    ORDER_WALLET_USE: "استُخدم في طلب",
    RETURN_REFUND: "استرداد مرتجع",
    ORDER_CANCELLATION_REFUND: "استرداد طلب ملغى",
  },
  adjust: "تعديل المحفظة",
  direction: "الاتجاه",
  directions: { CREDIT: "إضافة رصيد", DEBIT: "خصم رصيد" },
  adjustConfirm: {
    CREDIT: "إضافة {amount} جنيه إلى هذه المحفظة؟",
    DEBIT: "خصم {amount} جنيه من هذه المحفظة؟",
  },
  adjusted: "تم تسجيل التعديل.",
  deliveriesIntro: "محاولات إرسال البريد وواتساب وحالات الفشل.",
  orderId: "رقم الطلب",
  template: "الرسالة",
  recipient: "المستلم",
  attempt: "المحاولة",
  failure: "سبب الفشل",
  providerReference: "مرجع المزوّد",
  sentAt: "أُرسلت",
  deliveryStatuses: {
    PENDING: "معلّقة",
    SENT: "أُرسلت",
    FAILED: "فشلت",
    FALLBACK_SENT: "أُرسلت بالقناة البديلة",
  },
  hiddenContact: "مخفي",
  conflicts: {
    CODE_TAKEN: "يوجد خصم آخر بهذا الكود.",
    CAMPAIGN_STATUS_INVALID: "تغيّرت حالة الحملة. حدّث الصفحة وحاول مرة أخرى.",
    CAMPAIGN_AUDIENCE_EMPTY: "لا يوجد عميل في هذا الجمهور موافق على القناة الآن.",
    CUSTOMER_DEACTIVATED: "حساب العميل معطّل.",
    SELF_APPROVAL: "لا يمكنك الموافقة على حملة أرسلتها. يجب أن يوافق مالك أو مسؤول آخر.",
  },
  conflict: "يتعارض هذا مع الحالة الحالية. حدّث الصفحة وحاول مرة أخرى.",
  notFound: "غير موجود. تحقق من الرقم وحاول مرة أخرى.",
  insufficientFunds: "المتاح في المحفظة {n} جنيه فقط.",
  idempotencyConflict: "أُرسل هذا التعديل من قبل بتفاصيل مختلفة. حاول مرة أخرى.",
};

export const MARKETING_DICTIONARIES = { ar, en };

export function useMarketingT(): {
  t: Dictionary;
  m: MarketingDictionary;
  english: boolean;
  fail: (error: unknown) => string;
  date: (iso: string | null) => string;
} {
  const t = useT();
  const english = t === DICTIONARIES.en;
  const m = english ? en : ar;
  return {
    t,
    m,
    english,
    fail: (error) => marketingError(t, m, error),
    date: (iso) => (iso ? new Date(iso).toLocaleString(english ? "en-GB" : "ar-EG") : m.none),
  };
}

/** A localized message for an API failure, including the feature reasons. */
export function marketingError(t: Dictionary, m: MarketingDictionary, error: unknown): string {
  if (!(error instanceof StaffApiError)) {
    return errorMessage(t, error);
  }
  const reason = String(error.details.reason ?? "");
  if (m.conflicts[reason]) {
    return m.conflicts[reason];
  }
  switch (error.code) {
    case "CONFLICT":
      return m.conflict;
    case "NOT_FOUND":
      return m.notFound;
    case "IDEMPOTENCY_CONFLICT":
      return m.idempotencyConflict;
    case "WALLET_INSUFFICIENT_FUNDS": {
      const available = Number(error.details.available ?? 0);
      return m.insufficientFunds.replace("{n}", formatPiastres(available) ?? "0.00");
    }
    default:
      return errorMessage(t, error);
  }
}
