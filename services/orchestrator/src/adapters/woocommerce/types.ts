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
  images?: WooProductImage[];
  categories?: { id: number; name: string }[];
  type?: 'simple' | 'variable' | 'grouped';
  inStock?: boolean;
  relatedIds?: number[];
  crossSellIds?: number[];
  upsellIds?: number[];
  purchasable?: boolean;
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
