/**
 * Stable WooCommerce adapter types. Flows depend only on these.
 *
 * Field names align with the canonical product spreadsheet:
 *   weight, name, costPrice, importPricePerSurface, importPricePer2Boxes,
 *   wholesalePrice, retailPrice, salePrice, status, image, barcode,
 *   detailedDescription, shortDescription, type, isDownloadable, downloadLink,
 *   categories, subCategory, manufacturer, tags, inventory,
 *   unitsPerBox, boxesPerLayer, layersPerSurface, boxesPerSurface
 */

export interface WooProductImage {
  src: string;
  alt?: string;
}

export interface WooProduct {
  id: string;
  name: string;
  /** Retail price shown to customers (מחיר קמעונאי) */
  price?: string;
  permalink?: string;
  description?: string;
  shortDescription?: string;
  detailedDescription?: string;
  images?: WooProductImage[];
  categories?: { id: number; name: string }[];
  subCategory?: string;
  type?: 'simple' | 'variable' | 'grouped';
  inStock?: boolean;
  /** Current inventory count (מלאי) */
  inventory?: number;
  relatedIds?: number[];
  crossSellIds?: number[];
  upsellIds?: number[];
  purchasable?: boolean;
  weight?: string;
  barcode?: string;
  /** Cost price in ILS (מחיר עלות בארץ) */
  costPrice?: string;
  /** Import price per surface/pallet (מחיר יבוא למשטח) */
  importPricePerSurface?: string;
  /** Import price per 2 boxes (מחירי יבוא לשני קרטונים) */
  importPricePer2Boxes?: string;
  /** Wholesale/stock price (מחיר סיטונאי) */
  wholesalePrice?: string;
  /** Retail price (מחיר קמעונאי) — same as price */
  retailPrice?: string;
  /** Sale/promo price (מחיר מבצע) */
  salePrice?: string;
  /** Product status (סטטוס) */
  status?: string;
  /** Whether the product is downloadable (ניתן להורדה) */
  isDownloadable?: boolean;
  /** Download link if downloadable (קישור להורדה) */
  downloadLink?: string;
  /** Manufacturer name (יצרן) */
  manufacturer?: string;
  tags?: string[];
  /** Units per box (יחידות בקרטון) */
  unitsPerBox?: number;
  /** Boxes per layer (קרטונים בשכבה) */
  boxesPerLayer?: number;
  /** Number of layers per surface/pallet (מספר שכבות במשטח) */
  layersPerSurface?: number;
  /** Boxes per surface/pallet (קרטונים במשטח) */
  boxesPerSurface?: number;
  metadata?: Record<string, unknown>;
}

export interface WooVariation {
  id: string;
  price?: string;
  attributes: { name: string; option: string }[];
  inStock?: boolean;
}

export interface WooCommerceAdapter {
  searchProducts(query: string, filters?: { category?: string; limit?: number }): Promise<WooProduct[]>;
  getProduct(productId: string): Promise<WooProduct | null>;
  getProductVariations(productId: string): Promise<WooVariation[]>;
  getRelatedProducts(productId: string): Promise<WooProduct[]>;
}
