/**
 * Mock WooCommerce adapter — in-memory catalog for dev/demo.
 * Used when INTEGRATION_MODE_WOO=mock or when REST/MCP env is missing.
 */

import type { WooCommerceAdapter, WooProduct, WooVariation } from './types';

const MOCK_PRODUCTS: WooProduct[] = [
  {
    id: 'item_1',
    name: 'Margherita Pizza',
    shortDescription: 'Classic pizza with fresh mozzarella, basil, and tomato sauce.',
    description: 'Our signature Margherita pizza features hand-stretched dough, San Marzano tomato sauce, fresh buffalo mozzarella, and fragrant basil leaves. Baked in a wood-fired oven at 450°C for the perfect crispy crust.',
    price: '49.90',
    images: [{ src: 'https://placehold.co/400x300/e74c3c/ffffff?text=Margherita+Pizza', alt: 'Margherita Pizza' }],
    categories: [{ id: 1, name: 'Pizza' }],
    type: 'simple',
    inStock: true,
    relatedIds: [],
    crossSellIds: [],
    upsellIds: [],
    manufacturerId: 'mock_manufacturer_a',
    manufacturerName: 'Mock Manufacturer A',
    boxesPerLayer: 6
  },
  {
    id: 'item_2',
    name: 'Veggie Bowl',
    shortDescription: 'Grain bowl with seasonal veggies, tahini dressing, and herbs.',
    description: 'A hearty grain bowl loaded with roasted seasonal vegetables, quinoa, fresh herbs, cherry tomatoes, avocado, and our house-made tahini dressing. Vegan-friendly and packed with nutrients.',
    price: '42.90',
    images: [{ src: 'https://placehold.co/400x300/27ae60/ffffff?text=Veggie+Bowl', alt: 'Veggie Bowl' }],
    categories: [{ id: 2, name: 'Bowls' }],
    type: 'simple',
    inStock: true,
    relatedIds: [],
    crossSellIds: [],
    upsellIds: [],
    manufacturerId: 'mock_manufacturer_a',
    manufacturerName: 'Mock Manufacturer A',
    boxesPerLayer: 8
  },
  {
    id: 'item_3',
    name: 'Chocolate Brownie',
    shortDescription: 'Rich dark chocolate brownie with sea salt flakes.',
    description: 'Indulgent dark chocolate brownie made with 70% Belgian chocolate, topped with Maldon sea salt flakes. Served warm with a scoop of vanilla ice cream on the side.',
    price: '24.90',
    images: [{ src: 'https://placehold.co/400x300/8e44ad/ffffff?text=Chocolate+Brownie', alt: 'Chocolate Brownie' }],
    categories: [{ id: 3, name: 'Desserts' }],
    type: 'simple',
    inStock: true,
    relatedIds: [],
    crossSellIds: [],
    upsellIds: [],
    manufacturerId: 'mock_manufacturer_a',
    manufacturerName: 'Mock Manufacturer A',
    boxesPerLayer: 10
  },
  {
    id: 'item_4',
    name: 'Spicy Chicken Wings',
    shortDescription: 'Crispy wings with house-made hot sauce and blue cheese dip.',
    description: 'Crispy fried chicken wings tossed in our signature hot sauce blend. Served with creamy blue cheese dip and celery sticks. Available in mild, medium, or hot.',
    price: '38.90',
    images: [{ src: 'https://placehold.co/400x300/e67e22/ffffff?text=Spicy+Wings', alt: 'Spicy Chicken Wings' }],
    categories: [{ id: 4, name: 'Starters' }],
    type: 'simple',
    inStock: true,
    relatedIds: [],
    crossSellIds: [],
    upsellIds: [],
    manufacturerId: 'mock_manufacturer_b',
    manufacturerName: 'Mock Manufacturer B',
    boxesPerLayer: 5
  },
  {
    id: 'item_5',
    name: 'Fresh Lemonade',
    shortDescription: 'House-squeezed lemonade with mint and a touch of honey.',
    description: 'Refreshing lemonade made from freshly squeezed lemons, a hint of raw honey, and fresh mint leaves. Served over ice.',
    price: '18.90',
    images: [{ src: 'https://placehold.co/400x300/f1c40f/333333?text=Lemonade', alt: 'Fresh Lemonade' }],
    categories: [{ id: 5, name: 'Drinks' }],
    type: 'simple',
    inStock: true,
    relatedIds: [],
    crossSellIds: [],
    upsellIds: [],
    manufacturerId: 'mock_manufacturer_b',
    manufacturerName: 'Mock Manufacturer B',
    boxesPerLayer: 12
  },
  {
    id: 'item_6',
    name: 'Caesar Salad',
    shortDescription: 'Romaine lettuce, croutons, parmesan, and classic Caesar dressing.',
    description: 'Crisp romaine lettuce with house-made garlic croutons, shaved Parmigiano-Reggiano, and our classic anchovy-free Caesar dressing. Add grilled chicken for extra protein.',
    price: '36.90',
    images: [{ src: 'https://placehold.co/400x300/2ecc71/ffffff?text=Caesar+Salad', alt: 'Caesar Salad' }],
    categories: [{ id: 6, name: 'Salads' }],
    type: 'simple',
    inStock: true,
    relatedIds: [],
    crossSellIds: [],
    upsellIds: [],
    manufacturerId: 'mock_manufacturer_b',
    manufacturerName: 'Mock Manufacturer B',
    boxesPerLayer: 9
  }
];

// Cross-sell mapping: productId → suggested product IDs
const CROSS_SELL_MAP: Record<string, string[]> = {
  item_1: ['item_5', 'item_6'],       // Pizza → Lemonade, Salad
  item_2: ['item_5', 'item_3'],       // Bowl → Lemonade, Brownie
  item_3: ['item_5'],                 // Brownie → Lemonade
  item_4: ['item_5', 'item_1'],       // Wings → Lemonade, Pizza
  item_5: ['item_3', 'item_4'],       // Lemonade → Brownie, Wings
  item_6: ['item_4', 'item_5']        // Salad → Wings, Lemonade
};

export const mockWooAdapter: WooCommerceAdapter = {
  async searchProducts(query: string, filters?: { category?: string; limit?: number }): Promise<WooProduct[]> {
    const q = query.toLowerCase();
    const limit = filters?.limit ?? 10;
    let results = MOCK_PRODUCTS;

    if (q) {
      results = MOCK_PRODUCTS.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.shortDescription?.toLowerCase().includes(q) ?? false) ||
          (p.description?.toLowerCase().includes(q) ?? false) ||
          (p.categories?.some((c) => c.name.toLowerCase().includes(q)) ?? false)
      );
    }

    if (filters?.category) {
      const cat = filters.category.toLowerCase();
      results = results.filter(
        (p) => p.categories?.some((c) => c.name.toLowerCase().includes(cat)) ?? false
      );
    }

    return results.slice(0, limit);
  },

  async getProduct(productId: string): Promise<WooProduct | null> {
    return MOCK_PRODUCTS.find((p) => p.id === productId) ?? null;
  },

  async getProductVariations(_productId: string): Promise<WooVariation[]> {
    // Mock products are all simple — no variations
    return [];
  },

  async getRelatedProducts(productId: string): Promise<WooProduct[]> {
    const relatedIds = CROSS_SELL_MAP[productId] ?? [];
    return MOCK_PRODUCTS.filter((p) => relatedIds.includes(p.id));
  }
};
