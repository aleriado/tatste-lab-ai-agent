export type Intent =
  | 'RECOMMEND'
  | 'ADD_TO_CART'
  | 'REMOVE_FROM_CART'
  | 'UPDATE_CART'
  | 'VIEW_CART'
  | 'CLEAR_CART'
  | 'PRODUCT_DETAIL'
  | 'CHECKOUT_INTENT'
  | 'JOIN_GROUP_ORDER'
  | 'CREATE_GROUP_ORDER'
  | 'GROUP_ORDER_STATUS'
  | 'CROSS_SELL'
  | 'GENERAL';

export interface InboundMessagePayload {
  channel: 'web' | 'whatsapp' | 'telegram';
  channel_user_id: string;
  text: string;
  email?: string;
  phone?: string;
  groupOrderCode?: string;
}

export interface ProductCard {
  id: string;
  name: string;
  /** Retail price (מחיר קמעונאי) */
  price?: string;
  imageUrl?: string;
  shortDescription?: string;
  description?: string;
  detailedDescription?: string;
  categories?: string[];
  subCategory?: string;
  type?: 'simple' | 'variable';
  inStock?: boolean;
  /** Current inventory count (מלאי) */
  inventory?: number;
  /** Manufacturer name (יצרן) */
  manufacturer?: string;
  tags?: string[];
  weight?: string;
  barcode?: string;
  /** Cost price in ILS (מחיר עלות בארץ) */
  costPrice?: string;
  /** Import price per surface (מחיר יבוא למשטח) */
  importPricePerSurface?: string;
  /** Import price per 2 boxes (מחירי יבוא לשני קרטונים) */
  importPricePer2Boxes?: string;
  /** Wholesale price (מחיר סיטונאי) */
  wholesalePrice?: string;
  /** Retail price (מחיר קמעונאי) */
  retailPrice?: string;
  /** Sale price (מחיר מבצע) */
  salePrice?: string;
  /** Product status (סטטוס) */
  status?: string;
  /** Whether the product is downloadable (ניתן להורדה) */
  isDownloadable?: boolean;
  /** Download link (קישור להורדה) */
  downloadLink?: string;
  /** Units per box (יחידות בקרטון) */
  unitsPerBox?: number;
  /** Boxes per layer (קרטונים בשכבה) */
  boxesPerLayer?: number;
  /** Layers per surface (מספר שכבות במשטח) */
  layersPerSurface?: number;
  /** Boxes per surface (קרטונים במשטח) */
  boxesPerSurface?: number;
}

export interface CartItemSnapshot {
  productId: string;
  variantId?: string;
  name: string;
  imageUrl?: string;
  unitPrice: string;
  quantity: number;
  lineTotal: string;
}

export interface CartSnapshot {
  items: CartItemSnapshot[];
  subtotal: string;
  total: string;
  currency: string;
  itemCount: number;
}

export interface GroupOrderSnapshot {
  code: string;
  status: string;
  moqCurrent: number;
  moqTarget: number;
  /** Manufacturer name used as the group order constraint */
  manufacturer?: string | null;
  participantCount: number;
  expiresAt?: string;
  progress?: {
    balancedLayers: number;
    totalBoxes: number;
    remainingToTarget: number;
    productLayers: {
      productId: string;
      quantity: number;
      boxesPerLayer: number;
      completedLayers: number;
      openedLayers: number;
    }[];
  };
}

export interface CheckoutLink {
  url: string;
  label: string;
  amountDueNow?: string;
  amountDueLater?: string;
}

export interface OrchestratorReply {
  trace_id: string;
  reply: string;
  intent?: string;
  thread_id: string;
  cards?: ProductCard[];
  cart?: CartSnapshot;
  suggestions?: string[];
  link?: CheckoutLink;
  groupOrder?: GroupOrderSnapshot;
}
