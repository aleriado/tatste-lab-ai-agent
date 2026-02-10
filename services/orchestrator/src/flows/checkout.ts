import { Thread } from '@taste-labs/db';

export interface CheckoutResult {
  reply: string;
  contextPatch: Record<string, unknown>;
}

export function runCheckoutFlow(thread: Thread): CheckoutResult {
  const checkoutUrl = `https://checkout.example.com/mock/${thread.id}`;

  const reply =
    'Great, let’s get you checked out.\n' +
    `You can complete your order here: ${checkoutUrl}\n` +
    'I’ll keep an eye out for the payment status.';

  const contextPatch: Record<string, unknown> = {
    last_intent: 'CHECKOUT_INTENT',
    step: 'awaiting_payment',
    checkout_url: checkoutUrl
  };

  return { reply, contextPatch };
}

