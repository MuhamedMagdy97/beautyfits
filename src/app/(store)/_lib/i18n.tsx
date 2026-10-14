"use client";

import { useRouter } from "next/navigation";
import { createContext, use } from "react";
import { StoreApiError } from "./api";
import { STORE_LANG_COOKIE, type Lang } from "./lang";

/** Storefront texts (R14): Arabic (right-to-left) and English. */

const en = {
  brand: "BeautyFits",
  tagline: "Beauty that fits you",
  switchLanguage: "العربية",
  loading: "Loading…",
  retry: "Try again",
  home: "Home",
  mainNav: "Main",
  account: "Account",
  cart: "Bag",
  cartItems: "Shopping bag, {n} items",
  hello: "Hello, {name}",
  signIn: "Sign in",
  register: "Create account",
  signOut: "Sign out",
  signOutEverywhere: "Sign out of all devices",
  email: "Email",
  password: "Password",
  passwordHint: "At least 12 characters. A long passphrase works well.",
  newPassword: "New password",
  fullName: "Full name",
  phone: "Mobile number",
  phoneHint: "Egyptian mobile, e.g. 01xxxxxxxxx",
  code: "Email code",
  loginTitle: "Sign in",
  registerTitle: "Create your account",
  verifyTitle: "Verify your email",
  codeSent: "We emailed a 6-digit code to {email}. It is valid for 5 minutes.",
  codeNotSent: "We could not send a code right now. Use “Send a new code”.",
  codeResent: "A new code was sent. Use the newest code.",
  resendCode: "Send a new code",
  verify: "Verify",
  forgotPassword: "Forgot your password?",
  forgotTitle: "Reset your password",
  forgotIntro: "Enter your account email. If it belongs to an account, we will email a code.",
  sendCode: "Send code",
  resetPassword: "Reset password",
  resetDone: "Your password was changed and every device was signed out. Sign in again.",
  backToSignIn: "Back to sign in",
  noAccount: "New to BeautyFits?",
  haveAccount: "Already have an account?",
  sessionExpired: "Your session has ended. Please sign in again.",
  signInRequired: "Please sign in to continue.",
  homeTitle: "Beauty that fits you",
  homeIntro: "Makeup, fragrance and skincare.",
  notFound: "This page does not exist.",
  backHome: "Back to the home page",
  somethingWrong: "Something went wrong.",
  errors: {
    AUTH_INVALID_CREDENTIALS: "The email or password is incorrect.",
    AUTH_EMAIL_NOT_VERIFIED: "Verify your email to sign in.",
    AUTH_OTP_INVALID: "The code is not valid.",
    AUTH_OTP_EXPIRED: "The code has expired. Ask for a new one.",
    AUTH_RATE_LIMITED: "Too many attempts. Try again in {s} seconds.",
    RATE_LIMITED: "Too many requests. Try again in {s} seconds.",
    FORBIDDEN: "This account cannot be used. Please contact customer service.",
    CONFLICT: "An account with this email or mobile number already exists.",
    UNAUTHENTICATED: "Your session has ended. Please sign in again.",
    NOT_FOUND: "This item could not be found.",
    VALIDATION_ERROR: "Please check the information you entered.",
    NETWORK_ERROR: "No connection to the server. Check your network and try again.",
    default: "Something went wrong. Please try again.",
  } as Record<string, string>,
  issues: {
    password_too_short: "The password must be at least 12 characters.",
    password_too_long: "The password is too long.",
    password_common: "This password is too common. Choose a less predictable passphrase.",
    phone_invalid: "Enter an Egyptian mobile number.",
  } as Record<string, string>,
};

export type Dictionary = typeof en;

const ar: Dictionary = {
  brand: "BeautyFits",
  tagline: "جمال يناسبك",
  switchLanguage: "English",
  loading: "جارٍ التحميل…",
  retry: "حاول مرة أخرى",
  home: "الرئيسية",
  mainNav: "القائمة الرئيسية",
  account: "حسابي",
  cart: "الحقيبة",
  cartItems: "حقيبة التسوق، {n} منتجات",
  hello: "مرحبًا، {name}",
  signIn: "تسجيل الدخول",
  register: "إنشاء حساب",
  signOut: "تسجيل الخروج",
  signOutEverywhere: "تسجيل الخروج من كل الأجهزة",
  email: "البريد الإلكتروني",
  password: "كلمة المرور",
  passwordHint: "12 حرفًا على الأقل. العبارة الطويلة خيار جيد.",
  newPassword: "كلمة المرور الجديدة",
  fullName: "الاسم الكامل",
  phone: "رقم الموبايل",
  phoneHint: "رقم موبايل مصري، مثل 01xxxxxxxxx",
  code: "رمز البريد الإلكتروني",
  loginTitle: "تسجيل الدخول",
  registerTitle: "أنشئ حسابك",
  verifyTitle: "تأكيد بريدك الإلكتروني",
  codeSent: "أرسلنا رمزًا من 6 أرقام إلى {email}. الرمز صالح لمدة 5 دقائق.",
  codeNotSent: "تعذر إرسال الرمز الآن. استخدم «إرسال رمز جديد».",
  codeResent: "تم إرسال رمز جديد. استخدم أحدث رمز.",
  resendCode: "إرسال رمز جديد",
  verify: "تأكيد",
  forgotPassword: "نسيت كلمة المرور؟",
  forgotTitle: "إعادة تعيين كلمة المرور",
  forgotIntro: "أدخل بريد حسابك. إذا كان مرتبطًا بحساب، سنرسل إليه رمزًا.",
  sendCode: "إرسال الرمز",
  resetPassword: "إعادة تعيين كلمة المرور",
  resetDone: "تم تغيير كلمة المرور وتسجيل الخروج من كل الأجهزة. سجّل الدخول مرة أخرى.",
  backToSignIn: "العودة إلى تسجيل الدخول",
  noAccount: "جديد في BeautyFits؟",
  haveAccount: "لديك حساب بالفعل؟",
  sessionExpired: "انتهت جلستك. يرجى تسجيل الدخول مرة أخرى.",
  signInRequired: "يرجى تسجيل الدخول للمتابعة.",
  homeTitle: "جمال يناسبك",
  homeIntro: "مكياج وعطور وعناية بالبشرة.",
  notFound: "هذه الصفحة غير موجودة.",
  backHome: "العودة إلى الصفحة الرئيسية",
  somethingWrong: "حدث خطأ ما.",
  errors: {
    AUTH_INVALID_CREDENTIALS: "البريد الإلكتروني أو كلمة المرور غير صحيحة.",
    AUTH_EMAIL_NOT_VERIFIED: "أكّد بريدك الإلكتروني لتسجيل الدخول.",
    AUTH_OTP_INVALID: "الرمز غير صالح.",
    AUTH_OTP_EXPIRED: "انتهت صلاحية الرمز. اطلب رمزًا جديدًا.",
    AUTH_RATE_LIMITED: "محاولات كثيرة. حاول مرة أخرى بعد {s} ثانية.",
    RATE_LIMITED: "طلبات كثيرة. حاول مرة أخرى بعد {s} ثانية.",
    FORBIDDEN: "لا يمكن استخدام هذا الحساب. يرجى التواصل مع خدمة العملاء.",
    CONFLICT: "يوجد حساب بهذا البريد الإلكتروني أو رقم الموبايل.",
    UNAUTHENTICATED: "انتهت جلستك. يرجى تسجيل الدخول مرة أخرى.",
    NOT_FOUND: "لم نجد هذا العنصر.",
    VALIDATION_ERROR: "يرجى مراجعة البيانات المدخلة.",
    NETWORK_ERROR: "لا يوجد اتصال بالخادم. تحقق من الشبكة وحاول مرة أخرى.",
    default: "حدث خطأ ما. يرجى المحاولة مرة أخرى.",
  },
  issues: {
    password_too_short: "يجب أن تتكون كلمة المرور من 12 حرفًا على الأقل.",
    password_too_long: "كلمة المرور طويلة جدًا.",
    password_common: "كلمة المرور هذه شائعة جدًا. اختر عبارة يصعب توقعها.",
    phone_invalid: "أدخل رقم موبايل مصريًا.",
  },
};

export const DICTIONARIES: Record<Lang, Dictionary> = { ar, en };

const LangContext = createContext<Lang>("ar");

export function LangProvider({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  return <LangContext value={lang}>{children}</LangContext>;
}

export function useLang(): Lang {
  return use(LangContext);
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
    document.cookie = `${STORE_LANG_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
    router.refresh();
  };
}

/**
 * A localized message for an API failure. Known validation issue codes are
 * translated; the API's own English messages are not shown to shoppers.
 */
export function errorMessage(t: Dictionary, error: unknown): string {
  if (!(error instanceof StoreApiError)) {
    return t.errors.default;
  }
  const issues = error.details.issues;
  if (error.code === "VALIDATION_ERROR" && Array.isArray(issues)) {
    const known = issues
      .map((issue: { code?: string }) => t.issues[issue.code ?? ""])
      .filter(Boolean);
    if (known.length > 0) {
      return [...new Set(known)].join(" ");
    }
  }
  const message = t.errors[error.code] ?? t.errors.default;
  return message.replace("{s}", String(error.details.retryAfterSeconds ?? 60));
}
