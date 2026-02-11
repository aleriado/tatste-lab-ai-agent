/**
 * Stable WooCommerce adapter types. Flows depend only on these.
 */

export interface WooProduct {
  id: string;
  name: string;
  price?: string;
  permalink?: string;
  description?: string;
}

export interface WooCommerceAdapter {
  searchProducts(query: string): Promise<WooProduct[]>;
  getProduct(productId: string): Promise<WooProduct | null>;
}
