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
    ],
  },
  {
    slug: "perfumes",
    nameEn: "Perfumes",
    nameAr: "عطور",
    children: [
      { slug: "womens-fragrance", nameEn: "Women's Fragrance", nameAr: "عطور نسائية" },
      { slug: "mens-fragrance", nameEn: "Men's Fragrance", nameAr: "عطور رجالية" },
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
    ],
  },
  {
    slug: "beauty-essentials",
    nameEn: "Beauty Essentials",
    nameAr: "أساسيات الجمال",
    children: [
      { slug: "hair-care", nameEn: "Hair Care", nameAr: "العناية بالشعر" },
      { slug: "body-care", nameEn: "Body Care", nameAr: "العناية بالجسم" },
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
