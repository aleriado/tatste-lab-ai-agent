export interface JoinGroupOrderResult {
  reply: string;
  contextPatch: Record<string, unknown>;
}

export function runJoinGroupOrderFlow(): JoinGroupOrderResult {
  const reply =
    'Group orders are part of Milestone 2.\n' +
    'For now I can note your interest and we’ll notify you once group ordering is available.';

  const contextPatch: Record<string, unknown> = {
    last_intent: 'JOIN_GROUP_ORDER'
  };

  return { reply, contextPatch };
}

