/**
 * Stable WooCommerce adapter types. Flows depend only on these.
 */

export interface WooProductImage {
  src: string;
  alt?: string;
}

export interface WooProduct {
  id: string;
  name: string;
  price?: string;
  permalink?: string;
  description?: string;
  shortDescription?: string;
  detailedDescription?: string;
  images?: WooProductImage[];
  categories?: { id: number; name: string }[];
  type?: 'simple' | 'variable' | 'grouped';
  inStock?: boolean;
  stockQuantity?: number;
  relatedIds?: number[];
  crossSellIds?: number[];
  upsellIds?: number[];
  purchasable?: boolean;
  weight?: string;
  barcode?: string;
  productType?: string;
  unitsPerBox?: number;
  layersPerSurface?: number;
  boxesPerSurface?: number;
  manufacturerId?: string;
  manufacturerName?: string;
  boxesPerLayer?: number;
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
