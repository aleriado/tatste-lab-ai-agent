import { mockCatalog } from '../catalog/mockCatalog';

export interface RecommendResult {
  reply: string;
  contextPatch: Record<string, unknown>;
}

export function runRecommendFlow(): RecommendResult {
  const lines = mockCatalog.map(
    (item, index) => `${index + 1}. ${item.name} — ${item.description}`
  );

  const reply =
    'Here are a few things you might like:\n' +
    lines.join('\n') +
    '\n\nReply with "add 1", "add 2", or "add 3" to add an item to your cart.';

  const contextPatch: Record<string, unknown> = {
    last_intent: 'RECOMMEND',
    last_recommendations: mockCatalog
  };

  return { reply, contextPatch };
}

