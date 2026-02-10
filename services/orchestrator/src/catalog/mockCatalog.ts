export interface CatalogItem {
  id: string;
  name: string;
  description: string;
  priceCents: number;
}

export const mockCatalog: CatalogItem[] = [
  {
    id: 'item_1',
    name: 'Margherita Pizza',
    description: 'Classic pizza with fresh mozzarella, basil, and tomato sauce.',
    priceCents: 1299
  },
  {
    id: 'item_2',
    name: 'Veggie Bowl',
    description: 'Grain bowl with seasonal veggies, tahini dressing, and herbs.',
    priceCents: 1199
  },
  {
    id: 'item_3',
    name: 'Chocolate Brownie',
    description: 'Rich dark chocolate brownie with sea salt flakes.',
    priceCents: 599
  }
];

