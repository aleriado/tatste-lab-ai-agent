import { Thread } from '@taste-labs/db';
import type { WooProduct } from '../adapters/woocommerce';

export interface AddToCartResult {
  reply: string;
  contextPatch: Record<string, unknown>;
}

export function runAddToCartFlow(text: string, thread: Thread): AddToCartResult {
  const match = text.match(/add\s+(\d+)/i);
  const index = match ? parseInt(match[1], 10) - 1 : -1;

  const lastRecommendations =
    ((thread.contextJson as any)?.last_recommendations as WooProduct[] | undefined) ?? [];

  const item = lastRecommendations[index];

  if (!item) {
    return {
      reply:
        'I could not understand which item to add. Please reply with "add 1", "add 2", or "add 3".',
      contextPatch: {
        last_intent: 'ADD_TO_CART'
      }
    };
  }

  const existingCart =
    ((thread.contextJson as any)?.cart as WooProduct[] | undefined) ?? [];

  const cart = [...existingCart, item];

  const reply =
    `Got it - I've added "${item.name}" to your cart.\n` +
    'Reply with "checkout" when you are ready to pay.';

  const contextPatch: Record<string, unknown> = {
    last_intent: 'ADD_TO_CART',
    cart,
    step: 'awaiting_checkout_confirmation'
  };

  return { reply, contextPatch };
}
