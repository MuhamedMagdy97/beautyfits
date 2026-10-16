import { useCatalogT } from "./catalog-i18n";

/**
 * Locations and shipping-rule screen texts (TASK-055A), Arabic and English
 * (R14). Generic words (save, status, names…) come from `catalog-i18n.ts`.
 */

const en = {
  locations: "Locations",
  locationsHint:
    "The 27 governorates are fixed; rename or deactivate them and manage their areas. Nothing is deleted.",
  code: "Code",
  areas: "Areas",
  areaCount: "{n} areas",
  noAreas: "No areas yet.",
  addArea: "Add area",
  rename: "Rename",
  show: "Show areas",
  hide: "Hide areas",
  search: "Search governorates",
  rules: "Shipping rules",
  rulesHint:
    "The most specific active rule wins: area, then governorate, then everywhere; then higher priority, then lower fee.",
  newRule: "New rule",
  editRule: "Edit rule",
  carrier: "Carrier",
  anyCarrier: "Staff choose",
  governorate: "Governorate",
  area: "Area",
  everywhere: "Everywhere",
  wholeGovernorate: "Whole governorate",
  allGovernorates: "All governorates",
  allCarriers: "All carriers",
  orderTotal: "Order total (EGP)",
  minOrderTotal: "From order total (EGP)",
  maxOrderTotal: "Below order total (EGP)",
  rangeHint: "From is included, below is excluded. Leave blank for no limit.",
  fee: "Fee (EGP)",
  priority: "Priority",
  priorityHint: "−1000 to 1000; higher wins among equally specific rules.",
  activeFrom: "Active from",
  activeTo: "Active until",
  period: "Active period",
  always: "Always",
  noLimit: "any",
  actions: "Actions",
  inactiveSuffix: " (inactive)",
  badFields: {
    shippingFee: "Enter the fee in pounds, e.g. 50 or 49.50.",
    minOrderTotal: "Enter the minimum order total in pounds, or leave it blank.",
    maxOrderTotal: "Enter the maximum order total in pounds, or leave it blank.",
    priority: "Priority is a whole number from −1000 to 1000.",
    activeFrom: "Pick a valid start time, or leave it blank.",
    activeTo: "Pick a valid end time, or leave it blank.",
  } as Record<string, string>,
};

type LocationsDictionary = typeof en;

const ar: LocationsDictionary = {
  locations: "المناطق",
  locationsHint:
    "المحافظات الـ27 ثابتة؛ يمكن تغيير أسمائها أو إيقافها وإدارة مناطقها. لا يُحذف شيء.",
  code: "الرمز",
  areas: "المناطق",
  areaCount: "{n} منطقة",
  noAreas: "لا توجد مناطق بعد.",
  addArea: "إضافة منطقة",
  rename: "تغيير الاسم",
  show: "عرض المناطق",
  hide: "إخفاء المناطق",
  search: "بحث في المحافظات",
  rules: "قواعد الشحن",
  rulesHint:
    "تُطبَّق القاعدة النشطة الأكثر تحديدًا: المنطقة ثم المحافظة ثم كل مكان؛ ثم الأعلى أولوية ثم الأقل رسومًا.",
  newRule: "قاعدة جديدة",
  editRule: "تعديل القاعدة",
  carrier: "شركة الشحن",
  anyCarrier: "يختارها الموظف",
  governorate: "المحافظة",
  area: "المنطقة",
  everywhere: "كل مكان",
  wholeGovernorate: "المحافظة كلها",
  allGovernorates: "كل المحافظات",
  allCarriers: "كل شركات الشحن",
  orderTotal: "إجمالي الطلب (ج.م)",
  minOrderTotal: "من إجمالي طلب (ج.م)",
  maxOrderTotal: "أقل من إجمالي طلب (ج.م)",
  rangeHint: "الحد الأدنى مشمول والأعلى غير مشمول. اتركه فارغًا لعدم التقييد.",
  fee: "الرسوم (ج.م)",
  priority: "الأولوية",
  priorityHint: "من −1000 إلى 1000؛ الأعلى يفوز بين القواعد المتساوية في التحديد.",
  activeFrom: "نشطة من",
  activeTo: "نشطة حتى",
  period: "فترة التفعيل",
  always: "دائمًا",
  noLimit: "أي",
  actions: "إجراءات",
  inactiveSuffix: " (موقوفة)",
  badFields: {
    shippingFee: "أدخل الرسوم بالجنيه، مثل 50 أو 49.50.",
    minOrderTotal: "أدخل الحد الأدنى لإجمالي الطلب بالجنيه، أو اتركه فارغًا.",
    maxOrderTotal: "أدخل الحد الأعلى لإجمالي الطلب بالجنيه، أو اتركه فارغًا.",
    priority: "الأولوية رقم صحيح من −1000 إلى 1000.",
    activeFrom: "اختر وقت بداية صحيحًا، أو اتركه فارغًا.",
    activeTo: "اختر وقت نهاية صحيحًا، أو اتركه فارغًا.",
  },
};

export const LOCATIONS_DICTIONARIES = { ar, en };

/** The shell, catalog and locations texts in the current language. */
export function useLocationsT() {
  const { t, c, english } = useCatalogT();
  return {
    t,
    c,
    l: english ? en : ar,
    english,
    date: (iso: string) => new Date(iso).toLocaleString(english ? "en-GB" : "ar-EG"),
  };
}
