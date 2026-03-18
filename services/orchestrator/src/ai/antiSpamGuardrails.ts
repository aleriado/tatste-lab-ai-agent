/**
 * Anti-Spam & Anti-Pressure Guardrails
 *
 * Enforces session-level and page-level limits on share/group order suggestions.
 * Counters are tracked server-side to prevent client-side manipulation.
 *
 * Rules:
 *  - Maximum 3 share suggestions per session
 *  - Maximum 1 share suggestion per page
 *  - No guilt language or artificial urgency
 */

import type { SessionContext } from '@taste-labs/shared';

const MAX_SHARE_PER_SESSION = 3;
const MAX_SHARE_PER_PAGE = 1;

// Server-side session store (in-memory, keyed by sessionId)
const sessionShareCounts = new Map<string, { total: number; perPage: Map<string, number> }>();

function getOrCreateSession(sessionId: string) {
  let entry = sessionShareCounts.get(sessionId);
  if (!entry) {
    entry = { total: 0, perPage: new Map() };
    sessionShareCounts.set(sessionId, entry);
  }
  return entry;
}

/**
 * Check whether a share suggestion is allowed for this session/page.
 * Uses server-side counters; does NOT trust client-supplied values.
 */
export function canSuggestShare(sessionContext: SessionContext): boolean {
  const session = getOrCreateSession(sessionContext.sessionId);

  if (session.total >= MAX_SHARE_PER_SESSION) return false;

  const pageCount = session.perPage.get(sessionContext.currentPage) ?? 0;
  if (pageCount >= MAX_SHARE_PER_PAGE) return false;

  return true;
}

/**
 * Record that a share suggestion was shown for the given session/page.
 */
export function recordShareSuggestion(sessionId: string, page: string): void {
  const session = getOrCreateSession(sessionId);
  session.total += 1;
  session.perPage.set(page, (session.perPage.get(page) ?? 0) + 1);
}

/**
 * Get current share suggestion counts for a session.
 */
export function getSessionShareCount(sessionId: string): number {
  return sessionShareCounts.get(sessionId)?.total ?? 0;
}

export function getPageShareCount(sessionId: string, page: string): number {
  return sessionShareCounts.get(sessionId)?.perPage.get(page) ?? 0;
}

/**
 * Clean up expired session data (call periodically).
 */
export function clearSessionData(sessionId: string): void {
  sessionShareCounts.delete(sessionId);
}
