import express from 'express';
import { z } from 'zod';
import {
  appendMessage,
  Channel,
  cleanupExpiredGroupOrders,
  Customer,
  getOrCreateForegroundThread,
  getOrCreateCart,
  computeCartSummary,
  getRecentMessages,
  MessageDirection,
  resolveCustomer,
  Thread,
  updateThreadContext
} from '@taste-labs/db';
import { createLinkCode } from '@taste-labs/db';
import { createTelegramWebhookHandler } from './channels/telegram/webhook';
import type { OrchestratorReply } from '@taste-labs/shared';
import { runChatLoop } from './ai/chatLoop';
import { syncHubspotForIntent } from './adapters/hubspot';
import { getPaymentAdapter } from './adapters/payment';
import { logInfo, logError } from './logger';

// Legacy fallback imports (used when LLM is unavailable)
import { classifyIntent } from './intent/classifier';
import { runRecommendFlow } from './flows/recommend';
import { runAddToCartFlow } from './flows/addToCart';
import { runCheckoutFlow } from './flows/checkout';
import { runJoinGroupOrderFlow } from './flows/joinGroupOrder';

const app = express();
app.use(express.json());

// CORS for local dev
const ALLOWED_ORIGINS = new Set([
  'http://localhost:3301',
  'http://localhost:3302',
  'http://solguardian.xyz',
  'https://solguardian.xyz',
  'http://www.solguardian.xyz',
  'https://www.solguardian.xyz',
]);

app.use((req, res, next) => {
  const origin = req.headers.origin ?? '';
  if (ALLOWED_ORIGINS.has(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  return next();
});

const contextMetadataSchema = z.object({
  currentPage: z.enum(['catalog', 'product_detail', 'cart', 'checkout', 'group_orders', 'profile']),
  product: z.object({
    id: z.string(),
    name: z.string(),
    manufacturer: z.string(),
    state: z.enum(['ACTIVE_IMPORTED', 'CATALOG_EXTENSION']),
    pricingTiers: z.object({
      retail: z.string().optional(),
      wholesale: z.string().optional(),
      importPerSurface: z.string().optional(),
      importPer2Boxes: z.string().optional(),
    }),
    dreamStage: z.string().optional(),
  }).optional(),
  activeGroupOrder: z.object({
    code: z.string(),
    manufacturer: z.string(),
    progress: z.number(),
    participantCount: z.number(),
    daysLeft: z.number(),
  }).optional(),
  userType: z.enum(['private_consumer', 'retailer']),
}).optional();

const inboundSchema = z.object({
  channel: z.enum(['web', 'whatsapp', 'telegram']),
  channel_user_id: z.string().min(1),
  text: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  groupOrderCode: z.string().optional(),
  contextMetadata: contextMetadataSchema,
});

function toPrismaChannel(channel: 'web' | 'whatsapp' | 'telegram'): Channel {
  return channel;
}
function toMessageDirection(direction: 'inbound' | 'outbound'): MessageDirection {
  return direction;
}
function createTraceId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2);
}

const hasOpenAI = (): boolean => !!process.env.OPENAI_API_KEY;

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', mode: hasOpenAI() ? 'ai' : 'legacy' });
});

async function processMessage(
  payload: {
    channel: 'web' | 'whatsapp' | 'telegram';
    channel_user_id: string;
    text: string;
    email?: string | null;
    phone?: string | null;
    groupOrderCode?: string;
    contextMetadata?: z.infer<typeof contextMetadataSchema>;
  },
  traceId: string
): Promise<OrchestratorReply> {
  const channel = toPrismaChannel(payload.channel);

  const customer: Customer = await resolveCustomer(
    channel,
    payload.channel_user_id,
    payload.email,
    payload.phone
  );

  const thread: Thread = await getOrCreateForegroundThread(customer.id);

  await appendMessage({
    customerId: customer.id,
    threadId: thread.id,
    channel,
    direction: toMessageDirection('inbound'),
    text: payload.text,
    traceId
  });

  let responseBody: OrchestratorReply;

  if (hasOpenAI()) {
    const cart = await getOrCreateCart(customer.id);
    const cartSummary = computeCartSummary(cart);

    const recentMessages = await getRecentMessages(thread.id, 10);
    const conversationHistory = recentMessages
      .reverse()
      .filter((m) => m.text)
      .map((m) => ({
        role: (m.direction === 'inbound' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: m.text!
      }));

    const contextMetadata = payload.contextMetadata ?? undefined;
    const sessionContext = {
      sessionId: thread.id,
      customerId: customer.id,
      userType: (contextMetadata?.userType ?? 'private_consumer') as 'private_consumer' | 'retailer',
      currentPage: contextMetadata?.currentPage ?? 'catalog',
      shareSuggestionsCount: 0,
      shareSuggestionsPerPage: {} as Record<string, number>,
      activeGroupOrders: contextMetadata?.activeGroupOrder ? [contextMetadata.activeGroupOrder.code] : [],
      activeImportOrders: [] as string[],
    };

    const result = await runChatLoop({
      userMessage: payload.text,
      conversationHistory,
      systemPromptContext: {
        cart: cartSummary,
        groupOrderCode: payload.groupOrderCode ?? null,
        customerPreferences: (customer.preferencesJson as Record<string, unknown>) ?? null,
        contextMetadata: contextMetadata ?? null,
        sessionContext,
      },
      toolContext: {
        customerId: customer.id,
        traceId,
        sessionContext,
      }
    });

    const inferredIntent = inferIntent(payload.text, result);

    await Promise.all([
      updateThreadContext(thread.id, { last_intent: inferredIntent }),
      appendMessage({
        customerId: customer.id,
        threadId: thread.id,
        channel,
        direction: toMessageDirection('outbound'),
        text: result.reply,
        traceId,
        meta: {
          cards: result.cards?.length ?? 0,
          hasCart: !!result.cart,
          hasLink: !!result.link,
          hasGroupOrder: !!(result.groupOrder ?? result.groupOrders?.length),
          hasImportOrder: !!(result.importOrder ?? result.importOrders?.length),
        }
      })
    ]);

    if (inferredIntent === 'RECOMMEND' || inferredIntent === 'ADD_TO_CART' || inferredIntent === 'CHECKOUT_INTENT') {
      syncHubspotForIntent({ customer, intent: inferredIntent as any, thread, traceId })
        .catch((err) => logError('HubSpot sync failed in pipeline', { traceId, err }));
    }

    responseBody = {
      trace_id: traceId,
      reply: result.reply,
      intent: inferredIntent,
      thread_id: thread.id,
      cards: result.cards,
      cart: result.cart,
      suggestions: result.suggestions,
      link: result.link,
      groupOrder: result.groupOrder,
      importOrder: result.importOrder,
      groupOrders: result.groupOrders,
      importOrders: result.importOrders,
      quantityPrompt: result.quantityPrompt,
    };
  } else {
    const intent = classifyIntent(payload.text);
    let replyText: string;
    let contextPatch: Record<string, unknown> = {};

    switch (intent) {
      case 'RECOMMEND': {
        const result = await runRecommendFlow();
        replyText = result.reply;
        contextPatch = result.contextPatch;
        break;
      }
      case 'ADD_TO_CART': {
        const result = runAddToCartFlow(payload.text, thread);
        replyText = result.reply;
        contextPatch = result.contextPatch;
        break;
      }
      case 'CHECKOUT_INTENT': {
        const result = runCheckoutFlow(thread);
        replyText = result.reply;
        contextPatch = result.contextPatch;
        break;
      }
      case 'JOIN_GROUP_ORDER': {
        const result = runJoinGroupOrderFlow();
        replyText = result.reply;
        contextPatch = result.contextPatch;
        break;
      }
      default: {
        replyText = 'I am not sure how to help with that yet.';
        contextPatch = { last_intent: intent };
      }
    }

    await updateThreadContext(thread.id, { ...contextPatch, last_intent: intent });

    await appendMessage({
      customerId: customer.id,
      threadId: thread.id,
      channel,
      direction: toMessageDirection('outbound'),
      text: replyText,
      traceId
    });

    if (intent === 'RECOMMEND' || intent === 'ADD_TO_CART') {
      try {
        await syncHubspotForIntent({ customer, intent, thread, traceId });
      } catch (err) {
        logError('HubSpot sync failed in pipeline', { traceId, err });
      }
    }

    responseBody = {
      trace_id: traceId,
      reply: replyText,
      intent,
      thread_id: thread.id
    };
  }

  logInfo('Handled message', {
    traceId,
    customerId: customer.id,
    threadId: thread.id,
    channel: payload.channel,
    mode: hasOpenAI() ? 'ai' : 'legacy',
    intent: responseBody.intent
  });

  return responseBody;
}

app.post('/api/message', async (req, res) => {
  const traceId = createTraceId();
  logInfo('Received /api/message', { traceId, body: req.body });

  const parseResult = inboundSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      error: 'Invalid request body',
      details: parseResult.error.flatten(),
      trace_id: traceId
    });
  }

  try {
    const result = await processMessage(parseResult.data, traceId);
    return res.json(result);
  } catch (err) {
    logError('Error handling /api/message', { traceId, err });
    return res.status(500).json({ error: 'Internal server error', trace_id: traceId });
  }
});

// ── M3: Link code endpoint (web → Telegram/WhatsApp identity bridging) ──
app.post('/api/link-code', async (req, res) => {
  const { channel_user_id } = req.body ?? {};
  if (!channel_user_id || typeof channel_user_id !== 'string') {
    return res.status(400).json({ error: 'channel_user_id is required' });
  }
  try {
    const customer = await resolveCustomer('web', channel_user_id);
    const { code, expiresAt } = await createLinkCode(customer.id);
    const botUsername = process.env.TELEGRAM_BOT_USERNAME ?? '';
    const botUrl = botUsername ? `https://t.me/${botUsername}?start=${code}` : null;
    return res.json({ code, bot_url: botUrl, expires_in: 300, expires_at: expiresAt.toISOString() });
  } catch (err) {
    logError('Error creating link code', { err });
    return res.status(500).json({ error: 'Failed to create link code' });
  }
});

// ── M3: Telegram webhook ──
const telegramHandler = createTelegramWebhookHandler(async (payload) => {
  const traceId = createTraceId();
  return processMessage(payload, traceId);
});
app.post('/webhooks/telegram', telegramHandler);

// Mock payment confirmation endpoint
app.post('/api/mock-payment/confirm', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'token required' });

  try {
    const payment = getPaymentAdapter();
    const result = await payment.confirmPayment(token);
    return res.json(result);
  } catch (err) {
    logError('Mock payment confirm failed', { err });
    return res.status(400).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

const port = Number(process.env.PORT ?? '4000');
app.listen(port, () => {
  logInfo(`Orchestrator listening on port ${port} (mode: ${hasOpenAI() ? 'AI' : 'legacy'})`);

  const runCleanup = async () => {
    try {
      const result = await cleanupExpiredGroupOrders();
      if (result.markedExpired > 0 || result.deleted > 0) {
        logInfo('Group order cleanup', result);
      }
    } catch (err) {
      logError('Group order cleanup failed', { err });
    }
  };

  // Initial run shortly after startup, then periodically.
  setTimeout(runCleanup, 10_000);
  setInterval(runCleanup, 5 * 60 * 1000);
});

/**
 * Infer intent from user text and AI result for CRM/logging purposes.
 */
function inferIntent(text: string, result: { cards?: unknown[]; cart?: unknown; link?: unknown; groupOrder?: unknown; importOrder?: unknown }): string {
  const lower = text.toLowerCase();
  if (result.link) return 'CHECKOUT_INTENT';
  if (result.importOrder) return 'IMPORT_ORDER';
  if (result.groupOrder) return 'GROUP_ORDER';
  if (result.cart) return 'ADD_TO_CART';
  if (result.cards && (result.cards as any[]).length > 0) return 'RECOMMEND';
  if (/checkout|pay/i.test(lower)) return 'CHECKOUT_INTENT';
  if (/import|ייבוא/i.test(lower)) return 'IMPORT_ORDER';
  if (/\badd\b/i.test(lower)) return 'ADD_TO_CART';
  if (/cart|עגלה/i.test(lower)) return 'VIEW_CART';
  if (/group|join|קבוצ/i.test(lower)) return 'GROUP_ORDER';
  if (/status|סטטוס|מצב הזמנה/i.test(lower)) return 'ORDER_STATUS';
  if (/dream|חלום/i.test(lower)) return 'DREAM_LIST';
  return 'GENERAL';
}
