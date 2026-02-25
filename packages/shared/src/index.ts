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
  price?: string;
  imageUrl?: string;
  shortDescription?: string;
  description?: string;
  categories?: string[];
  type?: 'simple' | 'variable';
  inStock?: boolean;
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
  participantCount: number;
  expiresAt?: string;
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
