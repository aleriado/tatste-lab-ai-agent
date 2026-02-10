import express from 'express';
import { z } from 'zod';
import {
  appendMessage,
  Channel,
  Customer,
  getOrCreateForegroundThread,
  MessageDirection,
  Thread,
  updateThreadContext
} from '@taste-labs/db';
import { InboundMessagePayload, OrchestratorReply } from '@taste-labs/shared';
import { classifyIntent } from './intent/classifier';
import { runRecommendFlow } from './flows/recommend';
import { runAddToCartFlow } from './flows/addToCart';
import { runCheckoutFlow } from './flows/checkout';
import { runJoinGroupOrderFlow } from './flows/joinGroupOrder';
import { syncHubspotForIntent } from './adapters/hubspot';
import { logInfo, logError } from './logger';

const app = express();
app.use(express.json());

const inboundSchema = z.object({
  channel: z.enum(['web', 'whatsapp', 'telegram']),
  channel_user_id: z.string().min(1),
  text: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional()
});

function toPrismaChannel(channel: InboundMessagePayload['channel']): Channel {
  return channel;
}

function toMessageDirection(direction: 'inbound' | 'outbound'): MessageDirection {
  return direction;
}

function createTraceId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.post('/api/message', async (req, res) => {
  const parseResult = inboundSchema.safeParse(req.body);

  if (!parseResult.success) {
    return res.status(400).json({
      error: 'Invalid request body',
      details: parseResult.error.flatten()
    });
  }

  const payload = parseResult.data;
  const traceId = createTraceId();

  try {
    const channel = toPrismaChannel(payload.channel);

    const customer: Customer = await (await import('@taste-labs/db')).resolveCustomer(
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

    const intent = classifyIntent(payload.text);

    let replyText: string;
    let contextPatch: Record<string, unknown> = {};

    switch (intent) {
      case 'RECOMMEND': {
        const result = runRecommendFlow();
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

    await updateThreadContext(thread.id, {
      ...contextPatch,
      last_intent: intent
    });

    await appendMessage({
      customerId: customer.id,
      threadId: thread.id,
      channel,
      direction: toMessageDirection('outbound'),
      text: replyText,
      traceId
    });

    if (intent === 'RECOMMEND' || intent === 'ADD_TO_CART') {
      void syncHubspotForIntent({ customer, intent });
    }

    const responseBody: OrchestratorReply = {
      trace_id: traceId,
      reply: replyText,
      intent,
      thread_id: thread.id
    };

    logInfo('Handled /api/message', {
      traceId,
      customerId: customer.id,
      threadId: thread.id,
      intent
    });

    return res.json(responseBody);
  } catch (err) {
    logError('Error handling /api/message', err);
    return res.status(500).json({ error: 'Internal server error', trace_id: traceId });
  }
});

const port = Number(process.env.PORT ?? '4000');

app.listen(port, () => {
  logInfo(`Orchestrator listening on port ${port}`);
});

