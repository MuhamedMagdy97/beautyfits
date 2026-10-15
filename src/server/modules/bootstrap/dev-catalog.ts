import { readFile } from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "@/generated/prisma/client";
import type { Logger } from "@/server/logging/logger";
import { BootstrapError } from "@/server/modules/bootstrap/bootstrap";
import { createProductMediaService } from "@/server/modules/catalog/media-service";
import { createProductsService } from "@/server/modules/catalog/products-service";
import { createTaxonomyService } from "@/server/modules/catalog/taxonomy-service";
import { createInventoryService } from "@/server/modules/inventory/inventory-service";
import { builtInScanner } from "@/server/modules/media/scanner";
import { createUploadsService, UPLOAD_TOKEN_HEADER } from "@/server/modules/media/uploads-service";
import type { FileStorage } from "@/server/storage/storage";
import type { Clock } from "@/server/time/time";

/**
 * Development sample catalog (TASK-059A): brands, categories and published
 * products with prices, images and opening stock, so the storefront shows
 * something locally. Part of `npm run db:seed:dev`; never in production.
 *
 * Everything goes through the catalog, pricing, media and inventory
 * services as the Owner, so audit entries, upload checks and inventory
 * movements are the same as for staff-made data. Images are local files in
 * `prisma/fixtures/dev-catalog/` (one PNG per product slug).
 *
 * Idempotent: each step looks for what an earlier run made (brand and
 * product slugs, category slug under its parent, variant SKUs, current
 * images, inventory movements) and only adds what is missing, so a run that
 * stopped half way finishes on the next one. Existing data is never changed.
 */

export const DEV_CATALOG_FIXTURES_DIR = path.join("prisma", "fixtures", "dev-catalog");

const OPENING_STOCK_REASON = "Opening stock (development sample catalog)";

interface SampleVariant {
  sku: string;
  nameEn?: string;
  nameAr?: string;
  /** Piastres. */
  price: number;
  stock: number;
}

interface SampleProduct {
  slug: string;
  nameEn: string;
  nameAr: string;
  descriptionEn: string;
  descriptionAr: string;
  brand: string;
  /** Slug of a subcategory in `SAMPLE_CATEGORIES`. */
  category: string;
  variants: SampleVariant[];
}

export const SAMPLE_BRANDS = [
  { slug: "velvet-atelier", nameEn: "Velvet Atelier", nameAr: "فيلفت أتيليه" },
  { slug: "maison-rose", nameEn: "Maison Rose", nameAr: "ميزون روز" },
  { slug: "lumiere-lab", nameEn: "Lumiere Lab", nameAr: "لوميير لاب" },
  { slug: "nile-botanics", nameEn: "Nile Botanics", nameAr: "نايل بوتانيكس" },
  { slug: "golden-hour", nameEn: "Golden Hour", nameAr: "جولدن آور" },
  { slug: "oud-house", nameEn: "Oud House", nameAr: "بيت العود" },
  { slug: "pure-derma", nameEn: "Pure Derma", nameAr: "بيور ديرما" },
  { slug: "lotus-spa", nameEn: "Lotus Spa", nameAr: "لوتس سبا" },
] as const;

/** The home page tiles (Stitch homepage) with their subcategories. */
export const SAMPLE_CATEGORIES = [
  {
    slug: "makeup",
    nameEn: "Makeup",
    nameAr: "مكياج",
    children: [
      { slug: "lips", nameEn: "Lips", nameAr: "الشفاه" },
      { slug: "face", nameEn: "Face", nameAr: "الوجه" },
      { slug: "eyes", nameEn: "Eyes", nameAr: "العيون" },
      { slug: "nails", nameEn: "Nails", nameAr: "الأظافر" },
    ],
  },
  {
    slug: "perfumes",
    nameEn: "Perfumes",
    nameAr: "عطور",
    children: [
      { slug: "womens-fragrance", nameEn: "Women's Fragrance", nameAr: "عطور نسائية" },
      { slug: "mens-fragrance", nameEn: "Men's Fragrance", nameAr: "عطور رجالية" },
      { slug: "unisex-fragrance", nameEn: "Unisex Fragrance", nameAr: "عطور للجنسين" },
    ],
  },
  {
    slug: "skincare",
    nameEn: "Skincare",
    nameAr: "العناية بالبشرة",
    children: [
      { slug: "cleansers", nameEn: "Cleansers", nameAr: "منظفات" },
      { slug: "moisturizers", nameEn: "Moisturizers", nameAr: "مرطبات" },
      { slug: "serums", nameEn: "Serums", nameAr: "سيروم" },
      { slug: "sun-care", nameEn: "Sun Care", nameAr: "الحماية من الشمس" },
      { slug: "masks", nameEn: "Masks", nameAr: "ماسكات" },
    ],
  },
  {
    slug: "beauty-essentials",
    nameEn: "Beauty Essentials",
    nameAr: "أساسيات الجمال",
    children: [
      { slug: "hair-care", nameEn: "Hair Care", nameAr: "العناية بالشعر" },
      { slug: "body-care", nameEn: "Body Care", nameAr: "العناية بالجسم" },
      { slug: "bath-shower", nameEn: "Bath & Shower", nameAr: "الاستحمام" },
    ],
  },
] as const;

export const SAMPLE_PRODUCTS: readonly SampleProduct[] = [
  {
    slug: "velvet-matte-lipstick",
    nameEn: "Velvet Matte Lipstick",
    nameAr: "أحمر شفاه مات مخملي",
    descriptionEn: "A creamy matte lipstick with rich colour that lasts all day.",
    descriptionAr: "أحمر شفاه مات كريمي بلون غني يدوم طوال اليوم.",
    brand: "velvet-atelier",
    category: "lips",
    variants: [
      { sku: "DEV-VA-LIP-ROSE", nameEn: "Rose Nude", nameAr: "وردي نود", price: 45000, stock: 40 },
      { sku: "DEV-VA-LIP-BERRY", nameEn: "Berry", nameAr: "توتي", price: 45000, stock: 25 },
      {
        sku: "DEV-VA-LIP-RED",
        nameEn: "Classic Red",
        nameAr: "أحمر كلاسيكي",
        price: 45000,
        stock: 3,
      },
    ],
  },
  {
    slug: "silk-lip-gloss",
    nameEn: "Silk Lip Gloss",
    nameAr: "ملمع شفاه حريري",
    descriptionEn: "A non-sticky gloss for a glassy, hydrated shine.",
    descriptionAr: "ملمع غير لزج يمنح لمعانًا زجاجيًا وترطيبًا.",
    brand: "velvet-atelier",
    category: "lips",
    variants: [
      { sku: "DEV-VA-GLOSS-CLEAR", nameEn: "Clear", nameAr: "شفاف", price: 32000, stock: 30 },
      {
        sku: "DEV-VA-GLOSS-PINK",
        nameEn: "Pink Shimmer",
        nameAr: "وردي لامع",
        price: 32000,
        stock: 30,
      },
    ],
  },
  {
    slug: "second-skin-foundation",
    nameEn: "Second Skin Foundation",
    nameAr: "كريم أساس سكند سكن",
    descriptionEn: "A lightweight, buildable foundation with a natural finish.",
    descriptionAr: "كريم أساس خفيف قابل للبناء بلمسة طبيعية.",
    brand: "velvet-atelier",
    category: "face",
    variants: [
      { sku: "DEV-VA-FDN-IVORY", nameEn: "Ivory", nameAr: "عاجي", price: 89000, stock: 15 },
      { sku: "DEV-VA-FDN-BEIGE", nameEn: "Beige", nameAr: "بيج", price: 89000, stock: 20 },
      { sku: "DEV-VA-FDN-HONEY", nameEn: "Honey", nameAr: "عسلي", price: 89000, stock: 12 },
    ],
  },
  {
    slug: "lifting-mascara",
    nameEn: "Lifting Mascara",
    nameAr: "ماسكارا رافعة",
    descriptionEn: "Lifts and separates every lash without clumping.",
    descriptionAr: "ترفع الرموش وتفصلها دون تكتل.",
    brand: "velvet-atelier",
    category: "eyes",
    variants: [{ sku: "DEV-VA-MASCARA", price: 52000, stock: 50 }],
  },
  {
    slug: "nude-eyeshadow-palette",
    nameEn: "Nude Eyeshadow Palette",
    nameAr: "باليت ظلال عيون نود",
    descriptionEn: "Six blendable shades from soft matte to golden shimmer.",
    descriptionAr: "ست درجات سهلة الدمج من المات الناعم إلى اللامع الذهبي.",
    brand: "velvet-atelier",
    category: "eyes",
    variants: [{ sku: "DEV-VA-PALETTE-NUDE", price: 115000, stock: 18 }],
  },
  {
    slug: "rose-noir-eau-de-parfum",
    nameEn: "Rose Noir Eau de Parfum",
    nameAr: "عطر روز نوار أو دو بارفان",
    descriptionEn: "Dark rose, plum and patchouli for the evening.",
    descriptionAr: "ورد داكن وبرقوق وباتشولي للمساء.",
    brand: "maison-rose",
    category: "womens-fragrance",
    variants: [
      { sku: "DEV-MR-ROSENOIR-50", nameEn: "50 ml", nameAr: "50 مل", price: 320000, stock: 10 },
      { sku: "DEV-MR-ROSENOIR-100", nameEn: "100 ml", nameAr: "100 مل", price: 480000, stock: 6 },
    ],
  },
  {
    slug: "amber-oud-eau-de-parfum",
    nameEn: "Amber Oud Eau de Parfum",
    nameAr: "عطر عنبر وعود أو دو بارفان",
    descriptionEn: "Warm amber and smoky oud with a vanilla base.",
    descriptionAr: "عنبر دافئ وعود مدخن على قاعدة من الفانيليا.",
    brand: "maison-rose",
    category: "mens-fragrance",
    variants: [{ sku: "DEV-MR-AMBEROUD-100", price: 450000, stock: 8 }],
  },
  {
    slug: "jasmine-bloom-eau-de-toilette",
    nameEn: "Jasmine Bloom Eau de Toilette",
    nameAr: "عطر جاسمين بلوم أو دو تواليت",
    descriptionEn: "Fresh jasmine and citrus for every day.",
    descriptionAr: "ياسمين منعش وحمضيات لكل يوم.",
    brand: "maison-rose",
    category: "womens-fragrance",
    variants: [
      { sku: "DEV-MR-JASMINE-30", nameEn: "30 ml", nameAr: "30 مل", price: 180000, stock: 14 },
      { sku: "DEV-MR-JASMINE-90", nameEn: "90 ml", nameAr: "90 مل", price: 350000, stock: 9 },
    ],
  },
  {
    slug: "cedar-vetiver-eau-de-toilette",
    nameEn: "Cedar Vetiver Eau de Toilette",
    nameAr: "عطر سيدار فيتيفر أو دو تواليت",
    descriptionEn: "Crisp cedarwood and vetiver. Sold out, to show the out-of-stock state.",
    descriptionAr: "خشب الأرز ونجيل الهند. نفدت الكمية لعرض حالة عدم التوفر.",
    brand: "maison-rose",
    category: "mens-fragrance",
    variants: [{ sku: "DEV-MR-CEDAR-100", price: 290000, stock: 0 }],
  },
  {
    slug: "gentle-foaming-cleanser",
    nameEn: "Gentle Foaming Cleanser",
    nameAr: "غسول رغوي لطيف",
    descriptionEn: "Removes makeup and impurities without drying the skin.",
    descriptionAr: "يزيل المكياج والشوائب دون أن يجفف البشرة.",
    brand: "lumiere-lab",
    category: "cleansers",
    variants: [{ sku: "DEV-LL-CLEANSER-150", price: 38000, stock: 60 }],
  },
  {
    slug: "hydra-cloud-moisturizer",
    nameEn: "Hydra Cloud Moisturizer",
    nameAr: "مرطب هيدرا كلاود",
    descriptionEn: "A whipped gel cream for 24-hour hydration.",
    descriptionAr: "كريم جل خفيف لترطيب يدوم 24 ساعة.",
    brand: "lumiere-lab",
    category: "moisturizers",
    variants: [{ sku: "DEV-LL-MOIST-50", price: 75000, stock: 35 }],
  },
  {
    slug: "vitamin-c-glow-serum",
    nameEn: "Vitamin C Glow Serum",
    nameAr: "سيروم فيتامين سي للإشراق",
    descriptionEn: "Brightens dull skin and evens out the tone.",
    descriptionAr: "يفتح البشرة الباهتة ويوحد لونها.",
    brand: "lumiere-lab",
    category: "serums",
    variants: [{ sku: "DEV-LL-VITC-30", price: 99000, stock: 22 }],
  },
  {
    slug: "hyaluronic-acid-serum",
    nameEn: "Hyaluronic Acid Serum",
    nameAr: "سيروم حمض الهيالورونيك",
    descriptionEn: "Plumps and hydrates with three weights of hyaluronic acid.",
    descriptionAr: "يملأ البشرة ويرطبها بثلاثة أوزان من حمض الهيالورونيك.",
    brand: "lumiere-lab",
    category: "serums",
    variants: [
      { sku: "DEV-LL-HA-30", nameEn: "30 ml", nameAr: "30 مل", price: 85000, stock: 25 },
      { sku: "DEV-LL-HA-50", nameEn: "50 ml", nameAr: "50 مل", price: 125000, stock: 15 },
    ],
  },
  {
    slug: "argan-repair-hair-oil",
    nameEn: "Argan Repair Hair Oil",
    nameAr: "زيت الأرغان لإصلاح الشعر",
    descriptionEn: "Smooths frizz and adds shine to dry hair.",
    descriptionAr: "ينعّم الشعر المجعد ويمنح الشعر الجاف لمعانًا.",
    brand: "nile-botanics",
    category: "hair-care",
    variants: [{ sku: "DEV-NB-ARGAN-100", price: 42000, stock: 45 }],
  },
  {
    slug: "shea-body-butter",
    nameEn: "Shea Body Butter",
    nameAr: "زبدة الشيا للجسم",
    descriptionEn: "Rich shea butter that softens the driest skin.",
    descriptionAr: "زبدة شيا غنية تنعّم أكثر أنواع البشرة جفافًا.",
    brand: "nile-botanics",
    category: "body-care",
    variants: [{ sku: "DEV-NB-SHEA-200", price: 36000, stock: 40 }],
  },
  {
    slug: "rose-hand-cream",
    nameEn: "Rose Hand Cream",
    nameAr: "كريم اليدين بالورد",
    descriptionEn: "A quick-absorbing hand cream with Taif rose.",
    descriptionAr: "كريم يدين سريع الامتصاص بورد الطائف.",
    brand: "nile-botanics",
    category: "body-care",
    variants: [{ sku: "DEV-NB-HANDCREAM-75", price: 22000, stock: 70 }],
  },
  // Lips
  {
    slug: "precision-lip-liner",
    nameEn: "Precision Lip Liner",
    nameAr: "محدد شفاه دقيق",
    descriptionEn: "A creamy liner that shapes and stops lipstick from feathering.",
    descriptionAr: "محدد كريمي يرسم الشفاه ويمنع تسرب أحمر الشفاه.",
    brand: "golden-hour",
    category: "lips",
    variants: [
      { sku: "DEV-GH-LINER-NUDE", nameEn: "Nude", nameAr: "نود", price: 18500, stock: 55 },
      { sku: "DEV-GH-LINER-MAUVE", nameEn: "Mauve", nameAr: "موف", price: 18500, stock: 40 },
      { sku: "DEV-GH-LINER-BRICK", nameEn: "Brick", nameAr: "طوبي", price: 18500, stock: 20 },
    ],
  },
  {
    slug: "tinted-lip-balm",
    nameEn: "Tinted Lip Balm",
    nameAr: "مرطب شفاه ملون",
    descriptionEn: "Shea and beeswax balm with a sheer wash of colour.",
    descriptionAr: "مرطب بزبدة الشيا وشمع العسل مع لمسة لون خفيفة.",
    brand: "nile-botanics",
    category: "lips",
    variants: [{ sku: "DEV-NB-LIPBALM", price: 14500, stock: 90 }],
  },
  {
    slug: "satin-cream-lipstick",
    nameEn: "Satin Cream Lipstick",
    nameAr: "أحمر شفاه كريمي ساتان",
    descriptionEn: "A comfortable satin finish with a soft glow.",
    descriptionAr: "لمسة ساتان مريحة مع توهج ناعم.",
    brand: "golden-hour",
    category: "lips",
    variants: [
      { sku: "DEV-GH-SATIN-CORAL", nameEn: "Coral", nameAr: "مرجاني", price: 39500, stock: 30 },
      { sku: "DEV-GH-SATIN-PLUM", nameEn: "Plum", nameAr: "برقوقي", price: 39500, stock: 18 },
    ],
  },
  {
    slug: "plumping-lip-oil",
    nameEn: "Plumping Lip Oil",
    nameAr: "زيت شفاه منفخ",
    descriptionEn: "A nourishing oil with a gentle tingle for fuller-looking lips.",
    descriptionAr: "زيت مغذٍ بوخز لطيف لشفاه تبدو أكثر امتلاءً.",
    brand: "velvet-atelier",
    category: "lips",
    variants: [{ sku: "DEV-VA-LIPOIL", price: 34000, stock: 26 }],
  },
  {
    slug: "liquid-matte-lip-stain",
    nameEn: "Liquid Matte Lip Stain",
    nameAr: "صبغة شفاه سائلة مات",
    descriptionEn: "Transfer-proof liquid colour that dries to a soft matte.",
    descriptionAr: "لون سائل لا ينتقل يجف بلمسة مات ناعمة.",
    brand: "golden-hour",
    category: "lips",
    variants: [{ sku: "DEV-GH-STAIN", price: 29900, stock: 0 }],
  },
  // Face
  {
    slug: "radiant-cushion-foundation",
    nameEn: "Radiant Cushion Foundation",
    nameAr: "كريم أساس كوشن مشرق",
    descriptionEn: "A dewy cushion with medium coverage and SPF 30.",
    descriptionAr: "كوشن بلمسة ندية وتغطية متوسطة وعامل حماية 30.",
    brand: "golden-hour",
    category: "face",
    variants: [
      { sku: "DEV-GH-CUSHION-LIGHT", nameEn: "Light", nameAr: "فاتح", price: 112000, stock: 14 },
      { sku: "DEV-GH-CUSHION-MED", nameEn: "Medium", nameAr: "متوسط", price: 112000, stock: 16 },
    ],
  },
  {
    slug: "soft-blur-setting-powder",
    nameEn: "Soft Blur Setting Powder",
    nameAr: "بودرة تثبيت سوفت بلر",
    descriptionEn: "Translucent loose powder that sets makeup and blurs pores.",
    descriptionAr: "بودرة شفافة تثبت المكياج وتخفي المسام.",
    brand: "velvet-atelier",
    category: "face",
    variants: [{ sku: "DEV-VA-POWDER", price: 68000, stock: 24 }],
  },
  {
    slug: "cream-blush-stick",
    nameEn: "Cream Blush Stick",
    nameAr: "أحمر خدود كريمي ستيك",
    descriptionEn: "A blendable cream blush for cheeks and lips.",
    descriptionAr: "أحمر خدود كريمي سهل الدمج للخدود والشفاه.",
    brand: "golden-hour",
    category: "face",
    variants: [
      { sku: "DEV-GH-BLUSH-PEACH", nameEn: "Peach", nameAr: "خوخي", price: 41000, stock: 33 },
      { sku: "DEV-GH-BLUSH-ROSE", nameEn: "Rose", nameAr: "وردي", price: 41000, stock: 21 },
    ],
  },
  {
    slug: "liquid-highlighter",
    nameEn: "Liquid Highlighter",
    nameAr: "هايلايتر سائل",
    descriptionEn: "A few drops give a lit-from-within glow.",
    descriptionAr: "بضع قطرات تمنح إشراقة من الداخل.",
    brand: "velvet-atelier",
    category: "face",
    variants: [{ sku: "DEV-VA-HIGHLIGHT", price: 55000, stock: 19 }],
  },
  {
    slug: "full-cover-concealer",
    nameEn: "Full Cover Concealer",
    nameAr: "كونسيلر تغطية كاملة",
    descriptionEn: "Covers dark circles and blemishes without creasing.",
    descriptionAr: "يغطي الهالات والعيوب دون أن يتجمع في الخطوط.",
    brand: "velvet-atelier",
    category: "face",
    variants: [
      { sku: "DEV-VA-CONCEAL-FAIR", nameEn: "Fair", nameAr: "فاتح جدًا", price: 47500, stock: 22 },
      { sku: "DEV-VA-CONCEAL-SAND", nameEn: "Sand", nameAr: "رملي", price: 47500, stock: 28 },
      { sku: "DEV-VA-CONCEAL-TAN", nameEn: "Tan", nameAr: "برونزي", price: 47500, stock: 4 },
    ],
  },
  {
    slug: "sun-kissed-bronzer",
    nameEn: "Sun-Kissed Bronzer",
    nameAr: "برونزر صن كيسد",
    descriptionEn: "A silky matte bronzer for natural warmth.",
    descriptionAr: "برونزر مات حريري لدفء طبيعي.",
    brand: "golden-hour",
    category: "face",
    variants: [{ sku: "DEV-GH-BRONZER", price: 59000, stock: 17 }],
  },
  // Eyes
  {
    slug: "waterproof-eyeliner-pen",
    nameEn: "Waterproof Eyeliner Pen",
    nameAr: "قلم آيلاينر مقاوم للماء",
    descriptionEn: "A felt-tip liner for sharp wings that last all day.",
    descriptionAr: "قلم برأس لباد لرسم خطوط حادة تدوم طوال اليوم.",
    brand: "golden-hour",
    category: "eyes",
    variants: [{ sku: "DEV-GH-EYELINER", price: 27500, stock: 48 }],
  },
  {
    slug: "brow-sculpt-pencil",
    nameEn: "Brow Sculpt Pencil",
    nameAr: "قلم تحديد الحواجب",
    descriptionEn: "An ultra-fine pencil with a spoolie for natural brows.",
    descriptionAr: "قلم رفيع جدًا مع فرشاة لحواجب طبيعية.",
    brand: "velvet-atelier",
    category: "eyes",
    variants: [
      { sku: "DEV-VA-BROW-TAUPE", nameEn: "Taupe", nameAr: "رمادي بني", price: 23000, stock: 35 },
      {
        sku: "DEV-VA-BROW-DARK",
        nameEn: "Dark Brown",
        nameAr: "بني غامق",
        price: 23000,
        stock: 30,
      },
    ],
  },
  {
    slug: "volume-false-lashes",
    nameEn: "Volume False Lashes",
    nameAr: "رموش صناعية كثيفة",
    descriptionEn: "Lightweight, reusable lashes for a fuller look.",
    descriptionAr: "رموش خفيفة قابلة لإعادة الاستخدام لمظهر أكثف.",
    brand: "golden-hour",
    category: "eyes",
    variants: [{ sku: "DEV-GH-LASHES", price: 15500, stock: 65 }],
  },
  {
    slug: "smoky-eyeshadow-palette",
    nameEn: "Smoky Eyeshadow Palette",
    nameAr: "باليت ظلال عيون سموكي",
    descriptionEn: "Twelve deep mattes and metallics for evening looks.",
    descriptionAr: "اثنتا عشرة درجة مات ومعدنية داكنة لإطلالات المساء.",
    brand: "golden-hour",
    category: "eyes",
    variants: [{ sku: "DEV-GH-PALETTE-SMOKY", price: 135000, stock: 11 }],
  },
  // Nails
  {
    slug: "gel-shine-nail-polish",
    nameEn: "Gel Shine Nail Polish",
    nameAr: "طلاء أظافر جل لامع",
    descriptionEn: "Gel-like shine without a lamp, chip-resistant for a week.",
    descriptionAr: "لمعان يشبه الجل دون جهاز، يقاوم التقشر لمدة أسبوع.",
    brand: "velvet-atelier",
    category: "nails",
    variants: [
      { sku: "DEV-VA-NAIL-RED", nameEn: "Cherry", nameAr: "كرزي", price: 16500, stock: 40 },
      { sku: "DEV-VA-NAIL-NUDE", nameEn: "Ballet", nameAr: "باليه", price: 16500, stock: 45 },
      { sku: "DEV-VA-NAIL-NAVY", nameEn: "Navy", nameAr: "كحلي", price: 16500, stock: 15 },
    ],
  },
  {
    slug: "nail-strengthener",
    nameEn: "Nail Strengthener",
    nameAr: "مقوي الأظافر",
    descriptionEn: "A keratin base coat for weak, peeling nails.",
    descriptionAr: "طبقة أساس بالكيراتين للأظافر الضعيفة المتقشرة.",
    brand: "nile-botanics",
    category: "nails",
    variants: [{ sku: "DEV-NB-NAILSTRONG", price: 21000, stock: 37 }],
  },
  {
    slug: "cuticle-oil-pen",
    nameEn: "Cuticle Oil Pen",
    nameAr: "قلم زيت الجلد المحيط بالأظافر",
    descriptionEn: "Almond and jojoba oil in a click pen for on-the-go care.",
    descriptionAr: "زيت اللوز والجوجوبا في قلم للعناية أثناء التنقل.",
    brand: "nile-botanics",
    category: "nails",
    variants: [{ sku: "DEV-NB-CUTICLE", price: 12500, stock: 80 }],
  },
  {
    slug: "quick-dry-top-coat",
    nameEn: "Quick Dry Top Coat",
    nameAr: "طبقة علوية سريعة الجفاف",
    descriptionEn: "Dries polish in sixty seconds with a high-gloss finish.",
    descriptionAr: "يجفف الطلاء في ستين ثانية بلمسة لامعة.",
    brand: "velvet-atelier",
    category: "nails",
    variants: [{ sku: "DEV-VA-TOPCOAT", price: 14000, stock: 50 }],
  },
  // Women's fragrance
  {
    slug: "velvet-orchid-eau-de-parfum",
    nameEn: "Velvet Orchid Eau de Parfum",
    nameAr: "عطر فيلفت أوركيد أو دو بارفان",
    descriptionEn: "Black orchid, honey and suede.",
    descriptionAr: "أوركيد أسود وعسل وجلد سويدي.",
    brand: "maison-rose",
    category: "womens-fragrance",
    variants: [
      { sku: "DEV-MR-ORCHID-50", nameEn: "50 ml", nameAr: "50 مل", price: 395000, stock: 9 },
      { sku: "DEV-MR-ORCHID-100", nameEn: "100 ml", nameAr: "100 مل", price: 560000, stock: 5 },
    ],
  },
  {
    slug: "white-musk-body-mist",
    nameEn: "White Musk Body Mist",
    nameAr: "معطر الجسم بالمسك الأبيض",
    descriptionEn: "A light, clean musk mist to layer all day.",
    descriptionAr: "رذاذ مسك نظيف وخفيف يمكن استخدامه طوال اليوم.",
    brand: "lotus-spa",
    category: "womens-fragrance",
    variants: [{ sku: "DEV-LS-MUSKMIST-250", price: 28500, stock: 60 }],
  },
  {
    slug: "peony-blush-eau-de-toilette",
    nameEn: "Peony Blush Eau de Toilette",
    nameAr: "عطر بيوني بلاش أو دو تواليت",
    descriptionEn: "Peony, pink pepper and pear for a bright day scent.",
    descriptionAr: "فاوانيا وفلفل وردي وكمثرى لعطر نهاري مشرق.",
    brand: "maison-rose",
    category: "womens-fragrance",
    variants: [{ sku: "DEV-MR-PEONY-75", price: 210000, stock: 12 }],
  },
  {
    slug: "royal-oud-rose-extrait",
    nameEn: "Royal Oud Rose Extrait",
    nameAr: "عطر رويال عود روز إكستريه",
    descriptionEn: "Taif rose over aged Cambodian oud. Our most concentrated scent.",
    descriptionAr: "ورد الطائف على عود كمبودي معتق. أكثر عطورنا تركيزًا.",
    brand: "oud-house",
    category: "womens-fragrance",
    variants: [{ sku: "DEV-OH-ROYALROSE-50", price: 1250000, stock: 3 }],
  },
  // Men's fragrance
  {
    slug: "midnight-leather-eau-de-parfum",
    nameEn: "Midnight Leather Eau de Parfum",
    nameAr: "عطر ميدنايت ليذر أو دو بارفان",
    descriptionEn: "Smoky leather, cardamom and tonka bean.",
    descriptionAr: "جلد مدخن وهيل وفول التونكا.",
    brand: "oud-house",
    category: "mens-fragrance",
    variants: [{ sku: "DEV-OH-LEATHER-100", price: 520000, stock: 7 }],
  },
  {
    slug: "citrus-marine-eau-de-toilette",
    nameEn: "Citrus Marine Eau de Toilette",
    nameAr: "عطر سيترس مارين أو دو تواليت",
    descriptionEn: "Bergamot, sea salt and driftwood.",
    descriptionAr: "برغموت وملح البحر وخشب الشاطئ.",
    brand: "maison-rose",
    category: "mens-fragrance",
    variants: [{ sku: "DEV-MR-MARINE-100", price: 240000, stock: 16 }],
  },
  {
    slug: "black-oud-intense",
    nameEn: "Black Oud Intense",
    nameAr: "عطر بلاك عود إنتنس",
    descriptionEn: "Dark oud, saffron and incense with long-lasting sillage.",
    descriptionAr: "عود داكن وزعفران وبخور بفوحان يدوم طويلًا.",
    brand: "oud-house",
    category: "mens-fragrance",
    variants: [
      { sku: "DEV-OH-BLACKOUD-50", nameEn: "50 ml", nameAr: "50 مل", price: 890000, stock: 6 },
      { sku: "DEV-OH-BLACKOUD-100", nameEn: "100 ml", nameAr: "100 مل", price: 1350000, stock: 4 },
    ],
  },
  // Unisex fragrance
  {
    slug: "white-oud-eau-de-parfum",
    nameEn: "White Oud Eau de Parfum",
    nameAr: "عطر وايت عود أو دو بارفان",
    descriptionEn: "Soft white oud with musk and iris.",
    descriptionAr: "عود أبيض ناعم مع المسك والسوسن.",
    brand: "oud-house",
    category: "unisex-fragrance",
    variants: [{ sku: "DEV-OH-WHITEOUD-100", price: 610000, stock: 8 }],
  },
  {
    slug: "saffron-amber-perfume-oil",
    nameEn: "Saffron Amber Perfume Oil",
    nameAr: "زيت عطري زعفران وعنبر",
    descriptionEn: "An alcohol-free perfume oil of saffron, amber and rose.",
    descriptionAr: "زيت عطري خالٍ من الكحول بالزعفران والعنبر والورد.",
    brand: "oud-house",
    category: "unisex-fragrance",
    variants: [{ sku: "DEV-OH-SAFFRON-12", price: 275000, stock: 13 }],
  },
  {
    slug: "bakhoor-musk-hair-mist",
    nameEn: "Bakhoor Musk Hair Mist",
    nameAr: "معطر الشعر بالبخور والمسك",
    descriptionEn: "A gentle hair perfume with bakhoor and white musk.",
    descriptionAr: "عطر شعر لطيف بالبخور والمسك الأبيض.",
    brand: "oud-house",
    category: "unisex-fragrance",
    variants: [{ sku: "DEV-OH-HAIRMIST-50", price: 69000, stock: 27 }],
  },
  // Cleansers
  {
    slug: "micellar-cleansing-water",
    nameEn: "Micellar Cleansing Water",
    nameAr: "ماء ميسيلار منظف",
    descriptionEn: "Lifts makeup and sunscreen with no rinsing.",
    descriptionAr: "يزيل المكياج وواقي الشمس دون الحاجة للشطف.",
    brand: "pure-derma",
    category: "cleansers",
    variants: [
      { sku: "DEV-PD-MICELLAR-200", nameEn: "200 ml", nameAr: "200 مل", price: 26500, stock: 70 },
      { sku: "DEV-PD-MICELLAR-400", nameEn: "400 ml", nameAr: "400 مل", price: 42000, stock: 40 },
    ],
  },
  {
    slug: "oil-cleansing-balm",
    nameEn: "Oil Cleansing Balm",
    nameAr: "بلسم تنظيف زيتي",
    descriptionEn: "Melts into an oil to dissolve long-wear makeup.",
    descriptionAr: "يذوب إلى زيت ليزيل المكياج طويل الثبات.",
    brand: "lumiere-lab",
    category: "cleansers",
    variants: [{ sku: "DEV-LL-BALM-100", price: 58000, stock: 29 }],
  },
  {
    slug: "salicylic-acne-cleanser",
    nameEn: "Salicylic Acne Cleanser",
    nameAr: "غسول حمض الساليسيليك لحب الشباب",
    descriptionEn: "2% salicylic acid gel to clear pores and calm breakouts.",
    descriptionAr: "جل بحمض الساليسيليك 2% لتنظيف المسام وتهدئة البثور.",
    brand: "pure-derma",
    category: "cleansers",
    variants: [{ sku: "DEV-PD-SALICYLIC-150", price: 34500, stock: 52 }],
  },
  // Moisturizers
  {
    slug: "ceramide-barrier-cream",
    nameEn: "Ceramide Barrier Cream",
    nameAr: "كريم السيراميد لحاجز البشرة",
    descriptionEn: "Restores the skin barrier for dry and sensitive skin.",
    descriptionAr: "يعيد بناء حاجز البشرة الجافة والحساسة.",
    brand: "pure-derma",
    category: "moisturizers",
    variants: [{ sku: "DEV-PD-CERAMIDE-50", price: 82000, stock: 31 }],
  },
  {
    slug: "overnight-repair-cream",
    nameEn: "Overnight Repair Cream",
    nameAr: "كريم الإصلاح الليلي",
    descriptionEn: "A rich night cream with squalane and peptides.",
    descriptionAr: "كريم ليلي غني بالسكوالين والببتيدات.",
    brand: "lumiere-lab",
    category: "moisturizers",
    variants: [{ sku: "DEV-LL-NIGHT-50", price: 135000, stock: 13 }],
  },
  // Serums
  {
    slug: "niacinamide-10-serum",
    nameEn: "Niacinamide 10% Serum",
    nameAr: "سيروم النياسيناميد 10%",
    descriptionEn: "Refines pores and balances oily skin.",
    descriptionAr: "يصغّر المسام ويوازن البشرة الدهنية.",
    brand: "pure-derma",
    category: "serums",
    variants: [{ sku: "DEV-PD-NIACIN-30", price: 54000, stock: 44 }],
  },
  {
    slug: "retinol-night-serum",
    nameEn: "Retinol Night Serum",
    nameAr: "سيروم الريتينول الليلي",
    descriptionEn: "Encapsulated retinol to smooth fine lines overnight.",
    descriptionAr: "ريتينول مغلف لتنعيم الخطوط الدقيقة أثناء الليل.",
    brand: "lumiere-lab",
    category: "serums",
    variants: [{ sku: "DEV-LL-RETINOL-30", price: 148000, stock: 10 }],
  },
  {
    slug: "peptide-firming-serum",
    nameEn: "Peptide Firming Serum",
    nameAr: "سيروم الببتيد لشد البشرة",
    descriptionEn: "Multi-peptide serum for firmer, bouncier skin.",
    descriptionAr: "سيروم متعدد الببتيدات لبشرة أكثر شدًا ومرونة.",
    brand: "lumiere-lab",
    category: "serums",
    variants: [{ sku: "DEV-LL-PEPTIDE-30", price: 175000, stock: 2 }],
  },
  // Sun care
  {
    slug: "invisible-sunscreen-spf50",
    nameEn: "Invisible Sunscreen SPF 50",
    nameAr: "واقي شمس شفاف SPF 50",
    descriptionEn: "A weightless gel sunscreen with no white cast.",
    descriptionAr: "واقي شمس جل خفيف لا يترك أثرًا أبيض.",
    brand: "pure-derma",
    category: "sun-care",
    variants: [{ sku: "DEV-PD-SPF50-50", price: 64000, stock: 58 }],
  },
  {
    slug: "tinted-mineral-sunscreen",
    nameEn: "Tinted Mineral Sunscreen",
    nameAr: "واقي شمس معدني ملون",
    descriptionEn: "Zinc oxide protection with a sheer, skin-evening tint.",
    descriptionAr: "حماية بأكسيد الزنك مع لون خفيف يوحد البشرة.",
    brand: "lumiere-lab",
    category: "sun-care",
    variants: [{ sku: "DEV-LL-MINERAL-40", price: 72000, stock: 23 }],
  },
  {
    slug: "after-sun-aloe-gel",
    nameEn: "After Sun Aloe Gel",
    nameAr: "جل الصبار بعد التعرض للشمس",
    descriptionEn: "Cools and soothes skin after a day in the sun.",
    descriptionAr: "يبرد البشرة ويهدئها بعد يوم تحت الشمس.",
    brand: "nile-botanics",
    category: "sun-care",
    variants: [{ sku: "DEV-NB-ALOE-200", price: 31000, stock: 46 }],
  },
  // Masks
  {
    slug: "clay-detox-mask",
    nameEn: "Clay Detox Mask",
    nameAr: "ماسك الطين لتنقية البشرة",
    descriptionEn: "Kaolin and Dead Sea mud to draw out impurities.",
    descriptionAr: "كاولين وطين البحر الميت لسحب الشوائب.",
    brand: "nile-botanics",
    category: "masks",
    variants: [{ sku: "DEV-NB-CLAY-100", price: 39000, stock: 34 }],
  },
  {
    slug: "hydrating-sheet-mask-set",
    nameEn: "Hydrating Sheet Mask Set",
    nameAr: "مجموعة ماسكات قماشية مرطبة",
    descriptionEn: "Five hyaluronic acid sheet masks for an instant boost.",
    descriptionAr: "خمسة ماسكات قماشية بحمض الهيالورونيك لترطيب فوري.",
    brand: "lumiere-lab",
    category: "masks",
    variants: [{ sku: "DEV-LL-SHEET-5", price: 25000, stock: 75 }],
  },
  {
    slug: "rose-sleeping-mask",
    nameEn: "Rose Sleeping Mask",
    nameAr: "ماسك النوم بالورد",
    descriptionEn: "An overnight gel mask with rose water for soft, rested skin.",
    descriptionAr: "ماسك جل ليلي بماء الورد لبشرة ناعمة ومرتاحة.",
    brand: "lotus-spa",
    category: "masks",
    variants: [{ sku: "DEV-LS-SLEEPMASK-75", price: 57000, stock: 20 }],
  },
  // Hair care
  {
    slug: "keratin-smooth-shampoo",
    nameEn: "Keratin Smooth Shampoo",
    nameAr: "شامبو الكيراتين للنعومة",
    descriptionEn: "Sulfate-free shampoo that tames frizz.",
    descriptionAr: "شامبو خالٍ من الكبريتات يروّض الشعر المجعد.",
    brand: "nile-botanics",
    category: "hair-care",
    variants: [
      { sku: "DEV-NB-KERATIN-250", nameEn: "250 ml", nameAr: "250 مل", price: 33000, stock: 50 },
      { sku: "DEV-NB-KERATIN-500", nameEn: "500 ml", nameAr: "500 مل", price: 52000, stock: 30 },
    ],
  },
  {
    slug: "rosemary-growth-hair-serum",
    nameEn: "Rosemary Growth Hair Serum",
    nameAr: "سيروم إكليل الجبل لنمو الشعر",
    descriptionEn: "Rosemary and caffeine scalp serum for thicker-looking hair.",
    descriptionAr: "سيروم لفروة الرأس بإكليل الجبل والكافيين لشعر يبدو أكثف.",
    brand: "nile-botanics",
    category: "hair-care",
    variants: [{ sku: "DEV-NB-ROSEMARY-50", price: 47000, stock: 38 }],
  },
  // Bath & shower
  {
    slug: "coconut-body-scrub",
    nameEn: "Coconut Body Scrub",
    nameAr: "مقشر الجسم بجوز الهند",
    descriptionEn: "Brown sugar and coconut oil for smooth, glowing skin.",
    descriptionAr: "سكر بني وزيت جوز الهند لبشرة ناعمة ومشرقة.",
    brand: "lotus-spa",
    category: "bath-shower",
    variants: [{ sku: "DEV-LS-SCRUB-250", price: 38500, stock: 42 }],
  },
  {
    slug: "lavender-bath-salts",
    nameEn: "Lavender Bath Salts",
    nameAr: "أملاح الاستحمام باللافندر",
    descriptionEn: "Epsom and sea salts with lavender oil to unwind.",
    descriptionAr: "ملح إبسوم وملح البحر بزيت اللافندر للاسترخاء.",
    brand: "lotus-spa",
    category: "bath-shower",
    variants: [{ sku: "DEV-LS-BATHSALT-500", price: 29500, stock: 36 }],
  },
  // Body care
  {
    slug: "vanilla-silk-body-lotion",
    nameEn: "Vanilla Silk Body Lotion",
    nameAr: "لوشن الجسم بالفانيليا الحريري",
    descriptionEn: "A fast-absorbing lotion with a warm vanilla scent.",
    descriptionAr: "لوشن سريع الامتصاص برائحة الفانيليا الدافئة.",
    brand: "lotus-spa",
    category: "body-care",
    variants: [{ sku: "DEV-LS-LOTION-300", price: 34000, stock: 55 }],
  },
  // More moisturizers and eyes
  {
    slug: "oil-free-gel-moisturizer",
    nameEn: "Oil-Free Gel Moisturizer",
    nameAr: "مرطب جل خالٍ من الزيوت",
    descriptionEn: "A light gel that hydrates oily skin without shine.",
    descriptionAr: "جل خفيف يرطب البشرة الدهنية دون لمعان.",
    brand: "pure-derma",
    category: "moisturizers",
    variants: [{ sku: "DEV-PD-GEL-50", price: 49500, stock: 47 }],
  },
  {
    slug: "kohl-kajal-pencil",
    nameEn: "Kohl Kajal Pencil",
    nameAr: "قلم كحل",
    descriptionEn: "Intense black kohl for the waterline, smudge-proof.",
    descriptionAr: "كحل أسود مكثف للخط الداخلي للعين، لا يتلطخ.",
    brand: "golden-hour",
    category: "eyes",
    variants: [{ sku: "DEV-GH-KOHL", price: 19900, stock: 85 }],
  },
];

export interface DevCatalogDeps {
  db: PrismaClient;
  clock: Clock;
  storage: FileStorage;
  logger: Logger;
  /** Folder with `<product slug>.png`; defaults to `DEV_CATALOG_FIXTURES_DIR`. */
  fixturesDir?: string;
}

export interface DevCatalogReport {
  brandsCreated: number;
  categoriesCreated: number;
  productsCreated: number;
  productsPublished: number;
}

export async function runDevCatalogSeed(
  deps: DevCatalogDeps,
  input: { nodeEnv: string },
): Promise<DevCatalogReport> {
  const { db, clock, storage, logger } = deps;
  if (input.nodeEnv === "production") {
    throw new BootstrapError("The development seed never runs with NODE_ENV=production.");
  }
  const owner = await db.employee.findFirst({
    where: { employeeLevel: "OWNER" },
    select: { id: true },
  });
  if (!owner) {
    throw new BootstrapError(
      "No Owner exists yet. Run `npm run db:seed` with the Owner details first.",
    );
  }
  const actor = { employeeId: owner.id };
  const taxonomy = createTaxonomyService({ db, clock });
  const products = createProductsService({ db, clock });
  const productMedia = createProductMediaService({ db, clock });
  const uploads = createUploadsService({ db, storage, scanner: builtInScanner, clock });
  const inventory = createInventoryService({ db, clock });
  const fixturesDir = deps.fixturesDir ?? DEV_CATALOG_FIXTURES_DIR;
  const report: DevCatalogReport = {
    brandsCreated: 0,
    categoriesCreated: 0,
    productsCreated: 0,
    productsPublished: 0,
  };

  const brandIds = new Map<string, string>();
  for (const sample of SAMPLE_BRANDS) {
    let brand = await db.brand.findUnique({ where: { slug: sample.slug }, select: { id: true } });
    if (!brand) {
      brand = await taxonomy.createBrand(actor, sample, logger);
      report.brandsCreated += 1;
    }
    brandIds.set(sample.slug, brand.id);
  }

  const categoryIds = new Map<string, string>();
  async function ensureCategory(
    sample: { slug: string; nameEn: string; nameAr: string },
    parentId: string | null,
  ): Promise<string> {
    let category = await db.category.findFirst({
      where: { slug: sample.slug, parentId },
      select: { id: true },
    });
    if (!category) {
      const { slug, nameEn, nameAr } = sample;
      category = await taxonomy.createCategory(actor, { slug, nameEn, nameAr, parentId }, logger);
      report.categoriesCreated += 1;
    }
    categoryIds.set(sample.slug, category.id);
    return category.id;
  }
  for (const top of SAMPLE_CATEGORIES) {
    const parentId = await ensureCategory(top, null);
    for (const child of top.children) {
      await ensureCategory(child, parentId);
    }
  }

  for (const sample of SAMPLE_PRODUCTS) {
    const [first, ...others] = sample.variants;
    let product = await db.product.findUnique({
      where: { slug: sample.slug },
      select: { id: true, status: true },
    });
    if (!product) {
      product = await products.createProduct(
        actor,
        {
          slug: sample.slug,
          nameEn: sample.nameEn,
          nameAr: sample.nameAr,
          descriptionEn: sample.descriptionEn,
          descriptionAr: sample.descriptionAr,
          brandId: brandIds.get(sample.brand),
          categoryIds: [categoryIds.get(sample.category)!],
          defaultVariant: variantInput(first),
        },
        logger,
      );
      report.productsCreated += 1;
    }
    const productId = product.id;
    for (const variant of others) {
      if (!(await db.productVariant.findUnique({ where: { sku: variant.sku } }))) {
        await products.createVariant(actor, productId, variantInput(variant), logger);
      }
    }

    if ((await db.productMedia.count({ where: { productId, removedAt: null } })) === 0) {
      const mediaAssetId = await uploadImage(sample.slug);
      await productMedia.addMedia(
        actor,
        productId,
        { mediaAssetId, altTextEn: sample.nameEn, altTextAr: sample.nameAr },
        logger,
      );
    }

    for (const variant of sample.variants) {
      const row = await db.productVariant.findUniqueOrThrow({
        where: { sku: variant.sku },
        select: { id: true, _count: { select: { inventoryMovements: true } } },
      });
      if (variant.stock > 0 && row._count.inventoryMovements === 0) {
        await inventory.adjust(
          actor,
          row.id,
          { type: "MANUAL_ADJUSTMENT", quantity: variant.stock, reason: OPENING_STOCK_REASON },
          logger,
        );
      }
    }

    if (product.status === "DRAFT") {
      await products.changeProductStatus(actor, productId, "publish", {}, logger);
      report.productsPublished += 1;
    }
  }

  /** Uploads a fixture through the normal upload flow (checks included); returns the file id. */
  async function uploadImage(slug: string): Promise<string> {
    const filename = `${slug}.png`;
    const bytes = await readFile(path.join(fixturesDir, filename));
    const uploader = {
      employeeId: owner!.id,
      permissions: new Set(["MANAGE_PRODUCT_MEDIA"] as const),
    };
    const started = await uploads.startUpload(
      uploader,
      { purpose: "PRODUCT_MEDIA", filename, mimeType: "image/png", sizeBytes: bytes.length },
      logger,
    );
    await uploads.receiveUpload(
      started.mediaAssetId,
      {
        token: started.upload.headers[UPLOAD_TOKEN_HEADER],
        contentType: "image/png",
        contentLength: String(bytes.length),
        body: new Blob([new Uint8Array(bytes)]).stream(),
      },
      logger,
    );
    await uploads.completeUpload(uploader, started.mediaAssetId, logger);
    return started.mediaAssetId;
  }

  logger.info("dev_catalog_seed.completed", { ...report });
  return report;
}

function variantInput(variant: SampleVariant) {
  return {
    sku: variant.sku,
    nameEn: variant.nameEn ?? null,
    nameAr: variant.nameAr ?? null,
    sellingPrice: BigInt(variant.price),
  };
}
