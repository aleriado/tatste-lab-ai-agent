export interface CreateCheckoutParams {
  customerId: string;
  cartTotal: number;
  currency: string;
  splitPayment: boolean;
  groupOrderId?: string;
  meta?: Record<string, unknown>;
}

export interface CheckoutSessionResult {
  sessionId: string;
  token: string;
  paymentUrl: string;
  amountDueNow: number;
  amountDueLater: number;
  totalAmount: number;
  currency: string;
}

export interface PaymentConfirmResult {
  status: 'success' | 'failed';
  paidAmount: number;
}

export interface PaymentAdapter {
  createCheckoutSession(params: CreateCheckoutParams): Promise<CheckoutSessionResult>;
  confirmPayment(token: string): Promise<PaymentConfirmResult>;
}
