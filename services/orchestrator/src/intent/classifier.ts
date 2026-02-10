import { Intent } from '@taste-labs/shared';

export function classifyIntent(text: string): Intent {
  const lower = text.toLowerCase();

  if (/\badd\b/.test(lower) || /^add\s+\d+/.test(lower)) {
    return 'ADD_TO_CART';
  }

  if (lower.includes('checkout') || lower.includes('pay')) {
    return 'CHECKOUT_INTENT';
  }

  if (lower.includes('group order') || lower.includes('join')) {
    return 'JOIN_GROUP_ORDER';
  }

  return 'RECOMMEND';
}

