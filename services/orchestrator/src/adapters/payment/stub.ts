/**
 * Payment stub adapter — generates mock checkout links and always confirms.
 * Real provider (Stripe, PayPlus, etc.) will replace this later.
 */

import type { PaymentAdapter, CreateCheckoutParams, CheckoutSessionResult, PaymentConfirmResult } from './types';
import { prisma } from '@taste-labs/db';
import { Decimal } from '@prisma/client/runtime/library';
import { logInfo } from '../../logger';

function generateToken(): string {
  return `pay_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export const stubPaymentAdapter: PaymentAdapter = {
  async createCheckoutSession(params: CreateCheckoutParams): Promise<CheckoutSessionResult> {
    const token = generateToken();
    const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
    const paymentUrl = `${appUrl}/pay/mock?token=${token}`;

    const amountDueNow = params.splitPayment
      ? Math.round(params.cartTotal * 50) / 100
      : params.cartTotal;
    const amountDueLater = params.splitPayment
      ? params.cartTotal - amountDueNow
      : 0;

    const session = await prisma.checkoutSession.create({
      data: {
        customerId: params.customerId,
        groupOrderId: params.groupOrderId ?? null,
        token,
        status: 'pending',
        currency: params.currency,
        totalAmount: new Decimal(params.cartTotal),
        amountDueNow: new Decimal(amountDueNow),
        amountDueLater: new Decimal(amountDueLater),
        paidAmount: new Decimal(0),
        meta: (params.meta ?? null) as any
      }
    });

    logInfo('Payment stub: checkout session created', {
      sessionId: session.id,
      token,
      totalAmount: params.cartTotal,
      amountDueNow,
      amountDueLater
    });

    return {
      sessionId: session.id,
      token,
      paymentUrl,
      amountDueNow,
      amountDueLater,
      totalAmount: params.cartTotal,
      currency: params.currency
    };
  },

  async confirmPayment(token: string): Promise<PaymentConfirmResult> {
    const session = await prisma.checkoutSession.findUnique({ where: { token } });
    if (!session) throw new Error(`Checkout session not found for token ${token}`);

    const paidAmount = Number(session.amountDueNow);

    await prisma.checkoutSession.update({
      where: { token },
      data: {
        status: 'paid',
        paidAmount: new Decimal(paidAmount)
      }
    });

    logInfo('Payment stub: payment confirmed', { token, paidAmount });

    return { status: 'success', paidAmount };
  }
};
