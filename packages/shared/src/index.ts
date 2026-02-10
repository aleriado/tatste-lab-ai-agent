export type Intent =
  | 'RECOMMEND'
  | 'ADD_TO_CART'
  | 'CHECKOUT_INTENT'
  | 'JOIN_GROUP_ORDER';

export interface InboundMessagePayload {
  channel: 'web' | 'whatsapp' | 'telegram';
  channel_user_id: string;
  text: string;
  email?: string;
  phone?: string;
}

export interface OrchestratorReply {
  trace_id: string;
  reply: string;
  intent: Intent;
  thread_id: string;
}

