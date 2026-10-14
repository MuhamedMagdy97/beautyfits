"use client";

import { useCallback, useEffect, useState } from "react";
import { StatusPanel } from "../../_components/ui";
import { staffApi } from "../../_lib/api";
import { DICTIONARIES, errorMessage, useT } from "../../_lib/i18n";
import { useStaffSession } from "../../_lib/session";

/**
 * Shared pieces of the administration screens (TASK-057): settings, roles,
 * approvals and audit logs. Texts live here so the shell dictionary
 * (`_lib/i18n.tsx`) stays untouched by feature screens.
 */

const en = {
  refresh: "Refresh",
  save: "Save",
  cancel: "Cancel",
  edit: "Edit",
  create: "Create",
  details: "Details",
  hide: "Hide",
  none: "—",
  previous: "Previous",
  next: "Next",
  page: "Page {p} of {n}",
  empty: "Nothing to show.",
  reasonOptional: "Reason (optional)",
  reasonRequired: "Reason (required)",
  saved: "Saved.",
  // Settings
  settingsIntro:
    "Owner and Admins change settings. Critical settings change only after another Owner or Admin approves.",
  critical: "Critical — needs approval",
  defaultValue: "Default",
  currentValue: "Current value",
  newValue: "New value",
  lastChange: "Last changed by {who}",
  pending: "Waiting for approval: {value} (asked by {who})",
  sentForApproval: "Sent for approval. It applies once another Owner or Admin approves it.",
  unchanged: "That is already the current value.",
  history: "Change history",
  setting: "Setting",
  changedBy: "Changed by",
  approvedBy: "Approved by",
  when: "When",
  from: "From",
  to: "To",
  settingNames: {
    "staff_session.max_lifetime_minutes": "Staff session maximum length",
    "staff_session.idle_timeout_minutes": "Staff session idle timeout",
    "catalog.max_images_per_product": "Images per product",
    "pricing.min_margin_basis_points": "Minimum margin warning",
    "cart.guest_expiry_days": "Guest cart expiry",
    "shipping.free_shipping_threshold": "Free-shipping threshold",
    "cod.confirmation_timeout_hours": "COD confirmation timeout",
    "cod.reminder_interval_hours": "COD reminder interval",
    "cod.reminder_max_count": "COD reminders at most",
    "cod.confirmation_channel": "COD confirmation channel",
    "shipping.delivery_failure_contact_threshold": "Failed deliveries before a contact task",
  } as Record<string, string>,
  units: {
    MINUTES: "minutes",
    HOURS: "hours",
    DAYS: "days",
    PIASTRES: "piastres (100 = 1 EGP)",
    BASIS_POINTS: "basis points (100 = 1%)",
    COUNT: "",
  } as Record<string, string>,
  // Approvals
  status: "Status",
  type: "Type",
  requestedBy: "Requested by",
  resolvedBy: "Resolved by",
  approve: "Approve",
  reject: "Reject",
  statuses: {
    PENDING: "Pending",
    APPROVED: "Approved",
    REJECTED: "Rejected",
    CANCELLED: "Cancelled",
  } as Record<string, string>,
  approvalTypes: {
    PURCHASE_ORDER: "Purchase order",
    PURCHASE_OVER_DELIVERY: "Over-delivery",
    SUPPLIER_RETURN: "Supplier return",
    MARKETING_CAMPAIGN: "Marketing campaign",
    CRITICAL_SETTING: "Critical setting",
  } as Record<string, string>,
  all: "All",
  // Audit
  action: "Action",
  entity: "Entity",
  actor: "Actor",
  filter: "Filter",
  before: "Before",
  after: "After",
  system: "System",
  // Roles
  roleName: "Name",
  description: "Description",
  permissions: "Permissions",
  employees: "Employees",
  newRole: "New role",
  ownerAdminOnly: "Owner/Admin only — cannot be given to a role",
  errors: {
    CONFLICT: "This conflicts with the current state. Refresh and try again.",
    NOT_FOUND: "Not found. It may have been removed.",
    SELF_APPROVAL: "You cannot resolve your own request. Another Owner or Admin must do it.",
    APPROVAL_PENDING: "A change is already waiting for approval.",
    SETTING_CHANGED_SINCE: "The setting changed since the request. Reject it and ask again.",
    ROLE_NAME_TAKEN: "Another role already uses this name.",
  } as Record<string, string>,
};

type AdminDictionary = typeof en;

const ar: AdminDictionary = {
  refresh: "تحديث",
  save: "حفظ",
  cancel: "إلغاء",
  edit: "تعديل",
  create: "إنشاء",
  details: "التفاصيل",
  hide: "إخفاء",
  none: "—",
  previous: "السابق",
  next: "التالي",
  page: "صفحة {p} من {n}",
  empty: "لا يوجد ما يُعرض.",
  reasonOptional: "السبب (اختياري)",
  reasonRequired: "السبب (مطلوب)",
  saved: "تم الحفظ.",
  settingsIntro:
    "يغيّر المالك والمسؤولون الإعدادات. لا تتغير الإعدادات الحرجة إلا بعد موافقة مالك أو مسؤول آخر.",
  critical: "حرج — يحتاج موافقة",
  defaultValue: "الافتراضي",
  currentValue: "القيمة الحالية",
  newValue: "القيمة الجديدة",
  lastChange: "آخر تغيير بواسطة {who}",
  pending: "بانتظار الموافقة: {value} (طلبه {who})",
  sentForApproval: "أُرسل للموافقة. يُطبَّق بعد موافقة مالك أو مسؤول آخر.",
  unchanged: "هذه هي القيمة الحالية بالفعل.",
  history: "سجل التغييرات",
  setting: "الإعداد",
  changedBy: "غيّره",
  approvedBy: "وافق عليه",
  when: "الوقت",
  from: "من",
  to: "إلى",
  settingNames: {
    "staff_session.max_lifetime_minutes": "أقصى مدة لجلسة الموظف",
    "staff_session.idle_timeout_minutes": "مهلة خمول جلسة الموظف",
    "catalog.max_images_per_product": "عدد الصور لكل منتج",
    "pricing.min_margin_basis_points": "حد تنبيه هامش الربح الأدنى",
    "cart.guest_expiry_days": "انتهاء سلة الزائر",
    "shipping.free_shipping_threshold": "حد الشحن المجاني",
    "cod.confirmation_timeout_hours": "مهلة تأكيد الدفع عند الاستلام",
    "cod.reminder_interval_hours": "الفاصل بين تذكيرات التأكيد",
    "cod.reminder_max_count": "أقصى عدد لتذكيرات التأكيد",
    "cod.confirmation_channel": "قناة تأكيد الدفع عند الاستلام",
    "shipping.delivery_failure_contact_threshold": "عدد محاولات التوصيل الفاشلة قبل مهمة التواصل",
  },
  units: {
    MINUTES: "دقيقة",
    HOURS: "ساعة",
    DAYS: "يوم",
    PIASTRES: "قرش (100 = 1 جنيه)",
    BASIS_POINTS: "نقطة أساس (100 = 1%)",
    COUNT: "",
  },
  status: "الحالة",
  type: "النوع",
  requestedBy: "مقدّم الطلب",
  resolvedBy: "تم البت بواسطة",
  approve: "موافقة",
  reject: "رفض",
  statuses: { PENDING: "معلّق", APPROVED: "تمت الموافقة", REJECTED: "مرفوض", CANCELLED: "ملغى" },
  approvalTypes: {
    PURCHASE_ORDER: "أمر شراء",
    PURCHASE_OVER_DELIVERY: "توريد زائد",
    SUPPLIER_RETURN: "مرتجع مورد",
    MARKETING_CAMPAIGN: "حملة تسويقية",
    CRITICAL_SETTING: "إعداد حرج",
  },
  all: "الكل",
  action: "الإجراء",
  entity: "الكيان",
  actor: "المنفّذ",
  filter: "تصفية",
  before: "قبل",
  after: "بعد",
  system: "النظام",
  roleName: "الاسم",
  description: "الوصف",
  permissions: "الصلاحيات",
  employees: "الموظفون",
  newRole: "دور جديد",
  ownerAdminOnly: "للمالك والمسؤول فقط — لا تُمنح لدور",
  errors: {
    CONFLICT: "يتعارض هذا مع الحالة الحالية. حدّث الصفحة وحاول مرة أخرى.",
    NOT_FOUND: "غير موجود. ربما تمت إزالته.",
    SELF_APPROVAL: "لا يمكنك البت في طلبك. يجب أن يقوم بذلك مالك أو مسؤول آخر.",
    APPROVAL_PENDING: "يوجد تغيير بانتظار الموافقة بالفعل.",
    SETTING_CHANGED_SINCE: "تغيّر الإعداد منذ تقديم الطلب. ارفضه واطلب من جديد.",
    ROLE_NAME_TAKEN: "يوجد دور آخر بهذا الاسم.",
  },
};

export function useAdminT() {
  const t = useT();
  const lang = t === DICTIONARIES.ar ? "ar" : "en";
  const a = lang === "ar" ? ar : en;
  /** Localized API failure, using the feature reason when there is one. */
  const fail = (error: unknown) => {
    const details = (error as { details?: { reason?: string } } | null)?.details;
    return (details?.reason && a.errors[details.reason]) || errorMessage(t, error);
  };
  const date = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString(lang === "ar" ? "ar-EG" : "en-GB") : a.none;
  return { t, a, lang, fail, date };
}

/** Loads a GET endpoint; `reload` fetches again. */
export function useLoad<T>(path: string) {
  const [state, setState] = useState<{ data?: T; error?: unknown; loading: boolean }>({
    loading: true,
  });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    staffApi<T>(path).then(
      (data) => active && setState({ data, loading: false }),
      (error: unknown) => active && setState({ error, loading: false }),
    );
    return () => {
      active = false;
    };
  }, [path, attempt]);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, reload };
}

/** Like `useLoad` for list endpoints that answer with `meta.pagination`. */
export function useLoadPage<T>(path: string) {
  const [state, setState] = useState<{
    items?: T[];
    totalPages: number;
    error?: unknown;
    loading: boolean;
  }>({ loading: true, totalPages: 0 });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    fetchPage<T>(path).then(
      (page) => active && setState({ ...page, loading: false }),
      (error: unknown) => active && setState({ error, loading: false, totalPages: 0 }),
    );
    return () => {
      active = false;
    };
  }, [path, attempt]);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, reload };
}

/**
 * `staffApi` returns only `data`; list screens also need `meta.pagination`.
 * On a failure, `staffApi` repeats the call: it refreshes an expired access
 * token or throws the mapped error.
 */
async function fetchPage<T>(
  path: string,
  retried = false,
): Promise<{ items: T[]; totalPages: number }> {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: { "x-auth-transport": "cookie" },
  }).catch(() => null);
  if (!response?.ok) {
    const items = await staffApi<T[]>(path);
    return retried ? { items, totalPages: 1 } : fetchPage<T>(path, true);
  }
  const body = (await response.json()) as {
    data: T[];
    meta?: { pagination?: { totalPages: number } };
  };
  return { items: body.data, totalPages: body.meta?.pagination?.totalPages ?? 1 };
}

/** Shows access denied unless the employee holds `permission`. */
export function Guard({
  permission,
  title,
  children,
}: {
  permission: string;
  title: string;
  children: React.ReactNode;
}) {
  const { t } = useAdminT();
  const { session } = useStaffSession();
  if (!session.permissions.includes(permission)) {
    return <StatusPanel title={title} message={t.accessDenied} />;
  }
  return <>{children}</>;
}

export function PageHeader({
  title,
  intro,
  onRefresh,
}: {
  title: string;
  intro?: string;
  onRefresh?: () => void;
}) {
  const { a } = useAdminT();
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-3xl text-ink">{title}</h1>
        {intro ? <p className="mt-2 max-w-2xl text-ink-soft">{intro}</p> : null}
      </div>
      {onRefresh ? (
        <Button tone="plain" onClick={onRefresh}>
          {a.refresh}
        </Button>
      ) : null}
    </div>
  );
}

/** Loading / error states of a loaded block. */
export function LoadState({
  loading,
  error,
  onRetry,
}: {
  loading: boolean;
  error?: unknown;
  onRetry: () => void;
}) {
  const { t, fail } = useAdminT();
  if (loading) {
    return (
      <p className="p-4 text-ink-soft" aria-busy>
        {t.loading}
      </p>
    );
  }
  if (error) {
    return (
      <StatusPanel
        title={t.somethingWrong}
        message={fail(error)}
        action={<Button onClick={onRetry}>{t.retry}</Button>}
      />
    );
  }
  return null;
}

export function Button({
  tone = "primary",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "primary" | "plain" | "danger" }) {
  const colors = {
    primary: "bg-plum text-white hover:bg-plum-soft",
    plain: "border border-line text-plum hover:bg-velvet-low",
    danger: "border border-danger text-danger hover:bg-danger-soft",
  }[tone];
  return (
    <button
      type="button"
      {...props}
      className={`rounded-md px-3 py-1.5 text-sm font-semibold disabled:opacity-60 ${colors}`}
    />
  );
}

export const inputClass =
  "rounded-md border border-line bg-velvet-low px-3 py-1.5 text-sm text-ink outline-none focus:border-plum focus:ring-2 focus:ring-blush";

export function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-line bg-white p-4">{children}</div>;
}

/** Raw JSON of a snapshot, left-to-right even in Arabic. */
export function Json({ value }: { value: unknown }) {
  return (
    <pre
      dir="ltr"
      className="max-h-64 overflow-auto rounded-md bg-velvet-low p-2 text-start text-xs text-ink"
    >
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export function Pager({
  page,
  totalPages,
  onPage,
}: {
  page: number;
  totalPages: number;
  onPage: (page: number) => void;
}) {
  const { a } = useAdminT();
  if (totalPages <= 1) {
    return null;
  }
  return (
    <div className="mt-4 flex items-center justify-center gap-3 text-sm">
      <Button tone="plain" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        {a.previous}
      </Button>
      <span>{a.page.replace("{p}", String(page)).replace("{n}", String(totalPages))}</span>
      <Button tone="plain" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
        {a.next}
      </Button>
    </div>
  );
}

export interface PersonRef {
  id: string;
  displayName: string;
}
