import { getWooAdapter } from '../adapters/woocommerce';
import type { WooProduct } from '../adapters/woocommerce';
import { logInfo } from '../logger';

export interface RecommendResult {
  reply: string;
  contextPatch: Record<string, unknown>;
}

export async function runRecommendFlow(): Promise<RecommendResult> {
  const woo = getWooAdapter();
  const products = await woo.searchProducts('');

  logInfo('Woo REST: searchProducts', { products });

  const list = products.length > 0 ? products.slice(0, 10) : [];
  const lines = list.map(
    (item: WooProduct, index: number) =>
      `${index + 1}. ${item.name}${item.description ? ` — ${item.description}` : ''}`
  );

  const reply =
    list.length > 0
      ? 'Here are a few things you might like:\n' +
        lines.join('\n') +
        '\n\nReply with "add 1", "add 2", or "add 3" to add an item to your cart.'
      : "I don't have any recommendations right now. Try again later or ask for a specific item.";

  const contextPatch: Record<string, unknown> = {
    last_intent: 'RECOMMEND',
    last_recommendations: list
  };

  return { reply, contextPatch };
}
