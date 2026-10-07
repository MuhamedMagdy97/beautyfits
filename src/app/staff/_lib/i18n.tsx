"use client";

import { useRouter } from "next/navigation";
import { createContext, use } from "react";
import { StaffApiError } from "./api";
import { LANG_COOKIE, type Lang } from "./lang";

/** Dashboard texts (R14): Arabic (right-to-left) and English. */

const en = {
  brand: "BeautyFits",
  staffDashboard: "Staff dashboard",
  switchLanguage: "العربية",
  loading: "Loading…",
  retry: "Try again",
  backToDashboard: "Back to the dashboard",
  signIn: "Sign in",
  signOut: "Sign out",
  signOutEverywhere: "Sign out everywhere",
  email: "Work email",
  password: "Password",
  newPassword: "New password",
  code: "Email code",
  continue: "Continue",
  verify: "Verify and sign in",
  resendCode: "Send a new code",
  codeSent: "We emailed a 6-digit code to you. It is valid for 5 minutes.",
  codeResent: "A new code was sent. Use the newest code.",
  forgotPassword: "Forgot your password?",
  backToSignIn: "Back to sign in",
  sessionExpired: "Your session has ended. Please sign in again.",
  signedOut: "You have been signed out.",
  resetTitle: "Reset your password",
  resetIntro: "Enter your work email. If it belongs to a staff account, we will email a code.",
  sendCode: "Send code",
  resetPassword: "Reset password",
  resetDone: "Your password was changed and every session was signed out. Sign in again.",
  acceptTitle: "Join the BeautyFits staff",
  acceptIntro: "Choose a password for your new staff account.",
  createAccount: "Create my account",
  acceptDone: "Your account is ready. Sign in; the first sign-in asks for an email code.",
  invitationMissing: "This invitation link is incomplete. Open the link from your email again.",
  welcome: "Welcome",
  overviewIntro: "Choose a section. You see the sections your roles allow.",
  noSections: "No sections are available to you yet. Ask your manager to assign a role.",
  sectionSoon: "This section is not available yet.",
  accessDenied: "You do not have permission to open this section.",
  notFound: "This page does not exist.",
  somethingWrong: "Something went wrong.",
  levels: { OWNER: "Owner", ADMIN: "Admin", MANAGER: "Manager", EMPLOYEE: "Employee" },
  groups: {
    catalog: "Catalog",
    sales: "Sales & service",
    purchasing: "Purchasing",
    marketing: "Marketing & insights",
    administration: "Administration",
  },
  sections: {
    overview: "Overview",
    products: "Products",
    inventory: "Inventory",
    orders: "Orders",
    customers: "Customers",
    returns: "Returns",
    wallet: "Wallets",
    shipping: "Shipping",
    suppliers: "Suppliers",
    purchases: "Purchase orders",
    discounts: "Discounts",
    marketing: "Campaigns",
    notifications: "Notification logs",
    analytics: "Analytics",
    employees: "Employees",
    roles: "Roles",
    approvals: "Approvals",
    "audit-logs": "Audit logs",
    settings: "Settings",
  } as Record<string, string>,
  errors: {
    AUTH_INVALID_CREDENTIALS: "The email or password is incorrect.",
    AUTH_OTP_INVALID: "The code or link is not valid.",
    AUTH_OTP_EXPIRED: "The code or link has expired. Start again.",
    AUTH_RATE_LIMITED: "Too many attempts. Try again in {s} seconds.",
    FORBIDDEN: "This account cannot sign in to the dashboard.",
    PERMISSION_DENIED: "You do not have permission to do this.",
    UNAUTHENTICATED: "Your session has ended. Please sign in again.",
    VALIDATION_ERROR: "Please check the highlighted information.",
    NETWORK_ERROR: "No connection to the server. Check your network and try again.",
    default: "Something went wrong. Please try again.",
  } as Record<string, string>,
};

export type Dictionary = typeof en;

const ar: Dictionary = {
  brand: "BeautyFits",
  staffDashboard: "لوحة تحكم الموظفين",
  switchLanguage: "English",
  loading: "جارٍ التحميل…",
  retry: "حاول مرة أخرى",
  backToDashboard: "العودة إلى لوحة التحكم",
  signIn: "تسجيل الدخول",
  signOut: "تسجيل الخروج",
  signOutEverywhere: "تسجيل الخروج من كل الأجهزة",
  email: "بريد العمل الإلكتروني",
  password: "كلمة المرور",
  newPassword: "كلمة المرور الجديدة",
  code: "رمز البريد الإلكتروني",
  continue: "متابعة",
  verify: "تحقق وسجّل الدخول",
  resendCode: "إرسال رمز جديد",
  codeSent: "أرسلنا رمزًا من 6 أرقام إلى بريدك. الرمز صالح لمدة 5 دقائق.",
  codeResent: "تم إرسال رمز جديد. استخدم أحدث رمز.",
  forgotPassword: "نسيت كلمة المرور؟",
  backToSignIn: "العودة إلى تسجيل الدخول",
  sessionExpired: "انتهت جلستك. يرجى تسجيل الدخول مرة أخرى.",
  signedOut: "تم تسجيل خروجك.",
  resetTitle: "إعادة تعيين كلمة المرور",
  resetIntro: "أدخل بريد العمل. إذا كان مرتبطًا بحساب موظف، سنرسل إليه رمزًا.",
  sendCode: "إرسال الرمز",
  resetPassword: "إعادة تعيين كلمة المرور",
  resetDone: "تم تغيير كلمة المرور وتسجيل الخروج من كل الجلسات. سجّل الدخول مرة أخرى.",
  acceptTitle: "انضم إلى فريق BeautyFits",
  acceptIntro: "اختر كلمة مرور لحساب الموظف الجديد.",
  createAccount: "إنشاء حسابي",
  acceptDone: "حسابك جاهز. سجّل الدخول؛ أول تسجيل دخول يطلب رمزًا عبر البريد.",
  invitationMissing: "رابط الدعوة غير مكتمل. افتح الرابط من بريدك مرة أخرى.",
  welcome: "مرحبًا",
  overviewIntro: "اختر قسمًا. تظهر لك الأقسام التي تسمح بها أدوارك.",
  noSections: "لا توجد أقسام متاحة لك بعد. اطلب من مديرك تعيين دور لك.",
  sectionSoon: "هذا القسم غير متاح بعد.",
  accessDenied: "ليست لديك صلاحية فتح هذا القسم.",
  notFound: "هذه الصفحة غير موجودة.",
  somethingWrong: "حدث خطأ ما.",
  levels: { OWNER: "المالك", ADMIN: "مسؤول", MANAGER: "مدير", EMPLOYEE: "موظف" },
  groups: {
    catalog: "الكتالوج",
    sales: "المبيعات والخدمة",
    purchasing: "المشتريات",
    marketing: "التسويق والتحليلات",
    administration: "الإدارة",
  },
  sections: {
    overview: "نظرة عامة",
    products: "المنتجات",
    inventory: "المخزون",
    orders: "الطلبات",
    customers: "العملاء",
    returns: "المرتجعات",
    wallet: "المحافظ",
    shipping: "الشحن",
    suppliers: "الموردون",
    purchases: "أوامر الشراء",
    discounts: "الخصومات",
    marketing: "الحملات",
    notifications: "سجل الإشعارات",
    analytics: "التحليلات",
    employees: "الموظفون",
    roles: "الأدوار",
    approvals: "الموافقات",
    "audit-logs": "سجل التدقيق",
    settings: "الإعدادات",
  },
  errors: {
    AUTH_INVALID_CREDENTIALS: "البريد الإلكتروني أو كلمة المرور غير صحيحة.",
    AUTH_OTP_INVALID: "الرمز أو الرابط غير صالح.",
    AUTH_OTP_EXPIRED: "انتهت صلاحية الرمز أو الرابط. ابدأ من جديد.",
    AUTH_RATE_LIMITED: "محاولات كثيرة. حاول مرة أخرى بعد {s} ثانية.",
    FORBIDDEN: "لا يمكن لهذا الحساب الدخول إلى لوحة التحكم.",
    PERMISSION_DENIED: "ليست لديك صلاحية لتنفيذ هذا الإجراء.",
    UNAUTHENTICATED: "انتهت جلستك. يرجى تسجيل الدخول مرة أخرى.",
    VALIDATION_ERROR: "يرجى مراجعة البيانات المدخلة.",
    NETWORK_ERROR: "لا يوجد اتصال بالخادم. تحقق من الشبكة وحاول مرة أخرى.",
    default: "حدث خطأ ما. يرجى المحاولة مرة أخرى.",
  },
};

export const DICTIONARIES: Record<Lang, Dictionary> = { ar, en };

const LangContext = createContext<Lang>("ar");

export function LangProvider({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  return <LangContext value={lang}>{children}</LangContext>;
}

export function useT(): Dictionary {
  return DICTIONARIES[use(LangContext)];
}

/** Language toggle: stores the choice and re-renders with the new direction. */
export function useSwitchLanguage(): () => void {
  const lang = use(LangContext);
  const router = useRouter();
  return () => {
    const next: Lang = lang === "ar" ? "en" : "ar";
    document.cookie = `${LANG_COOKIE}=${next}; Path=/staff; Max-Age=31536000; SameSite=Lax`;
    router.refresh();
  };
}

/** A localized message for an API failure, with server validation messages appended. */
export function errorMessage(t: Dictionary, error: unknown): string {
  if (!(error instanceof StaffApiError)) {
    return t.errors.default;
  }
  let message = t.errors[error.code] ?? t.errors.default;
  if (error.code === "AUTH_RATE_LIMITED") {
    message = message.replace("{s}", String(error.details.retryAfterSeconds ?? 60));
  }
  const issues = error.details.issues;
  if (error.code === "VALIDATION_ERROR" && Array.isArray(issues)) {
    const lines = issues.map((issue: { message?: string }) => issue.message).filter(Boolean);
    if (lines.length > 0) {
      message += ` (${lines.join("; ")})`;
    }
  }
  return message;
}
