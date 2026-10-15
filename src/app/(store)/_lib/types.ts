/**
 * Shapes of the API responses the storefront reads (API contract §11, §13,
 * §14, §15, §19, §20 and their task amendments). Money is integer piastres.
 */

export type StockStatus = "AVAILABLE" | "OUT_OF_STOCK";

export interface Image {
  url: string;
  width: number;
  height: number;
  alt: string | null;
}

export interface ProductSummary {
  id: string;
  slug: string;
  name: string;
  brand: { id: string; slug: string; name: string } | null;
  image: Image | null;
  minPrice: number;
  maxPrice: number;
  variantCount: number;
  status: StockStatus;
}

export interface Variant {
  id: string;
  sku: string;
  name: string | null;
  attributes: Record<string, string> | null;
  isDefault: boolean;
  price: number;
  status: StockStatus;
}

export interface Product extends Omit<ProductSummary, "image" | "variantCount"> {
  description: string | null;
  categories: { id: string; slug: string; name: string }[];
  images: (Image & { variantId: string | null })[];
  variants: Variant[];
}

export interface Category {
  id: string;
  slug: string;
  name: string;
  parentId: string | null;
  depth: number;
}

export interface Brand {
  id: string;
  slug: string;
  name: string;
}

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface CartItem {
  id: string;
  productId: string;
  variantId: string;
  slug: string;
  name: string;
  variantName: string | null;
  imageUrl: string | null;
  quantity: number;
  unitPrice: number | null;
  lastSeenUnitPrice: number;
  priceChanged: boolean;
  lineTotal: number | null;
  status: "AVAILABLE" | "INSUFFICIENT_STOCK" | "UNAVAILABLE";
  availableQuantity?: number;
}

export interface Cart {
  id: string | null;
  items: CartItem[];
  itemCount: number;
  subtotal: number;
  discount: {
    id: string;
    code: string | null;
    name: string;
    percentage: number;
    amount: number;
  } | null;
  discountProblem: { discountId: string; code: string | null; reason: string } | null;
  discountTotal: number;
  total: number;
  availableDiscounts: { id: string; name: string; percentage: number; amount: number }[];
  requiresReview: boolean;
}

export interface Address {
  id: string;
  label: string | null;
  recipientName: string;
  phone: string;
  governorate: { id: string; name: string; active: boolean };
  area: { id: string; name: string; active: boolean };
  city: string | null;
  street: string;
  building: string | null;
  floor: string | null;
  apartment: string | null;
  landmark: string | null;
  notes: string | null;
  isDefault: boolean;
}

export interface Governorate {
  id: string;
  name: string;
  areas: { id: string; name: string }[];
}

export interface Quote {
  items: CartItem[];
  subtotal: number;
  discountTotal: number;
  shippingFee: number;
  freeShipping: boolean;
  freeShippingThreshold: number;
  total: number;
  walletAmount: number;
  codAmount: number;
}

export interface PlacedOrder {
  id: string;
  orderNumber: string;
  status: string;
  total: number;
  codAmount: number;
  walletAmount: number;
}

export interface WishlistItem {
  id: string;
  productId: string;
  variantId: string;
  slug: string;
  name: string;
  variantName: string | null;
  imageUrl: string | null;
  unitPrice: number | null;
  status: "AVAILABLE" | "OUT_OF_STOCK" | "UNAVAILABLE";
}

export interface Review {
  id: string;
  rating: number;
  body: string;
  variantName: string | null;
  createdAt: string;
}
