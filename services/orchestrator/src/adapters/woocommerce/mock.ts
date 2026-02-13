/**
 * Mock WooCommerce adapter — in-memory catalog for M1 demo.
 * Used when INTEGRATION_MODE_WOO=mock or when MCP env is missing.
 */

import type { WooCommerceAdapter, WooProduct } from './types';

const MOCK_PRODUCTS: WooProduct[] = [
  {
    id: 'item_1',
    name: 'Margherita Pizza',
    description: 'Classic pizza with fresh mozzarella, basil, and tomato sauce.',
    price: '12.99',
    permalink: undefined
  },
  {
    id: 'item_2',
    name: 'Veggie Bowl',
    description: 'Grain bowl with seasonal veggies, tahini dressing, and herbs.',
    price: '11.99',
    permalink: undefined
  },
  {
    id: 'item_3',
    name: 'Chocolate Brownie',
    description: 'Rich dark chocolate brownie with sea salt flakes.',
    price: '5.99',
    permalink: undefined
  }
];

export const mockWooAdapter: WooCommerceAdapter = {
  async searchProducts(query: string): Promise<WooProduct[]> {
    const q = query.toLowerCase();
    if (!q) return [...MOCK_PRODUCTS];
    return MOCK_PRODUCTS.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.description?.toLowerCase().includes(q) ?? false)
    );
  },

  async getProduct(productId: string): Promise<WooProduct | null> {
    return MOCK_PRODUCTS.find((p) => p.id === productId) ?? null;
  }
};
