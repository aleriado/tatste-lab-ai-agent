import type { Intent } from '@taste-labs/shared';

export function classifyIntent(text: string): Intent {
  const lower = text.toLowerCase();

  // Import order patterns (Hebrew + English)
  if (/\bimport\b|ייבוא|הזמנת ייבוא/.test(lower)) {
    return 'IMPORT_ORDER';
  }

  // Order status patterns
  if (/\bstatus\b|סטטוס|מצב הזמנה|מה קורה עם/.test(lower)) {
    return 'ORDER_STATUS';
  }

  // Dream List patterns
  if (/dream\s*list|רשימת חלומות|חלומות/.test(lower)) {
    return 'DREAM_LIST';
  }

  // Order type selection
  if (/order\s*type|סוג הזמנה|אפשרויות הזמנה/.test(lower)) {
    return 'ORDER_TYPE_SELECT';
  }

  if (/\badd\b/.test(lower) || /^add\s+\d+/.test(lower) || /הוסף|תוסיף/.test(lower)) {
    return 'ADD_TO_CART';
  }

  if (lower.includes('checkout') || lower.includes('pay') || /תשלום|לשלם/.test(lower)) {
    return 'CHECKOUT_INTENT';
  }

  if (lower.includes('group order') || lower.includes('join') || /קבוצ|הצטרף/.test(lower)) {
    return 'JOIN_GROUP_ORDER';
  }

  return 'RECOMMEND';
}

