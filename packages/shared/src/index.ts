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
  | 'IMPORT_ORDER'
  | 'ORDER_STATUS'
  | 'DREAM_LIST'
  | 'ORDER_TYPE_SELECT'
  | 'GENERAL';

export interface InboundMessagePayload {
  channel: 'web' | 'whatsapp' | 'telegram';
  channel_user_id: string;
  text: string;
  email?: string;
  phone?: string;
  groupOrderCode?: string;
  contextMetadata?: ContextMetadata;
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
  /** Manufacturer / supplier name (יצרן / ספק) */
  manufacturer?: string;
  /** Brand name (מותג) */
  brand?: string;
  /** Country of origin (ארץ מקור) */
  countryOfOrigin?: string;
  /** SKU / barcode (ברקוד) */
  sku?: string;
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
  /** Product state for order-type routing (ACTIVE_IMPORTED = purchasable, CATALOG_EXTENSION = Dream List) */
  productState?: 'ACTIVE_IMPORTED' | 'CATALOG_EXTENSION';
  /** Dream List stage — tracks where a CATALOG_EXTENSION product is in the activation pipeline */
  dreamStage?: string;
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
  orderType?: string;
  orderTypeLabel?: string;
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
  moqSurfaces: number;
  surfaceMaxLayers?: number | null;
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
  surfaces?: {
    surfaceIndex: number;
    maxLayers: number;
    status: string;
    layers: {
      layerIndex: number;
      productId: string;
      productName?: string;
      unitPrice?: string;
      variantId: string | null;
      capacityBoxes: number;
      capacityUnits: number;
      filledBoxes: number;
      filledUnits: number;
      status: string;
    }[];
  }[];
  participantCosts?: {
    customerId: string;
    total: string;
    products: { name: string; units: number; cost: string }[];
  }[];
}

export interface CheckoutLink {
  url: string;
  label: string;
  amountDueNow?: string;
  amountDueLater?: string;
}

export interface ContextMetadata {
  currentPage: 'catalog' | 'product_detail' | 'cart' | 'checkout' | 'group_orders' | 'profile';
  product?: {
    id: string;
    name: string;
    manufacturer: string;
    state: 'ACTIVE_IMPORTED' | 'CATALOG_EXTENSION';
    pricingTiers: {
      retail?: string;
      wholesale?: string;
      importPerSurface?: string;
      importPer2Boxes?: string;
    };
    dreamStage?: string;
  };
  activeGroupOrder?: {
    code: string;
    manufacturer: string;
    progress: number;
    participantCount: number;
    daysLeft: number;
  };
  userType: 'private_consumer' | 'retailer';
}

export interface SessionContext {
  sessionId: string;
  customerId: string;
  userType: 'private_consumer' | 'retailer';
  currentPage: string;
  shareSuggestionsCount: number;
  shareSuggestionsPerPage: Record<string, number>;
  lastInterventionGate?: string;
  cookingContext?: string;
  activeGroupOrders: string[];
  activeImportOrders: string[];
}

export interface InterventionResult {
  gate: string;
  action: 'allow' | 'redirect' | 'block' | 'inform';
  message?: string;
  redirectTo?: string;
  data?: Record<string, unknown>;
}

export interface OrderTypeOption {
  type: 'regular' | 'stock' | 'group' | 'import';
  available: boolean;
  recommended: boolean;
  reason?: string;
  pricePerUnit?: string;
  /** Minimum order quantity in units (for this product: moqBoxes * unitsPerBox). */
  moq?: number;
  /** Minimum order quantity in boxes (stock orders). Use this for display. */
  moqBoxes?: number;
  existingOrders?: {
    code: string;
    progress: string;
    daysLeft?: number;
  }[];
}

export interface AvailableOrderTypes {
  productId: string;
  productName: string;
  productState: 'ACTIVE_IMPORTED' | 'CATALOG_EXTENSION';
  manufacturer: string;
  types: OrderTypeOption[];
  /** Units per box for this product. Use to convert "X boxes" to quantity: quantity = X * unitsPerBox when calling group_add_item / import_add_item. */
  unitsPerBox?: number;
}

export interface ImportOrderStatus {
  code: string;
  manufacturer: string;
  isImport: true;
  status: string;
  items: { productId: string; productName: string; quantity: number }[];
  paletteFill: {
    surfacesUsed: number;
    totalSurfaces: number;
    boxesFilled: number;
    totalBoxCapacity: number;
    percentFilled: number;
  };
  daysRemaining?: number;
}

/** Same shape as GroupOrderSnapshot so the same status UI can render both. Only difference: single participant (import order). */
export type ImportOrderSnapshot = GroupOrderSnapshot & { isImport: true };

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
  importOrder?: ImportOrderSnapshot;
}
