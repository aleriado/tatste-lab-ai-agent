import type { PaymentAdapter } from './types';
import { stubPaymentAdapter } from './stub';
import { logInfo } from '../../logger';

let cached: PaymentAdapter | null = null;

export function getPaymentAdapter(): PaymentAdapter {
  if (cached) return cached;

  // For M2: always use stub. Real provider plugged in later.
  cached = stubPaymentAdapter;
  logInfo('Payment adapter: stub');
  return cached;
}

export type { PaymentAdapter, CreateCheckoutParams, CheckoutSessionResult, PaymentConfirmResult } from './types';
