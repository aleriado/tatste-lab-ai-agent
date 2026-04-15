import type { Request, Response } from 'express';
import crypto from 'crypto';
import { consumeLinkCode, findCustomerByChannel, getLastAssistantMessage } from '@taste-labs/db';
import { sendWhatsAppMessage, sendWhatsAppCard, markAsRead } from './sender';
import { logInfo, logError } from '../../logger';

// ── WhatsApp Cloud API webhook payload types ─────────────────────────────────

interface WhatsAppMessage {
  from: string;        // sender phone number (e.g. "972501234567")
  id: string;          // message id for read receipts
  timestamp: string;
  type: string;
  text?: { body: string };
  button?: { text: string; payload: string };
}

interface WhatsAppWebhookPayload {
  object: string;
  entry?: Array<{
    id: string;
    changes?: Array<{
      value: {
        messaging_product: string;
        metadata: { display_phone_number: string; phone_number_id: string };
        contacts?: Array<{ profile: { name: string }; wa_id: string }>;
        messages?: WhatsAppMessage[];
        statuses?: unknown[];
      };
      field: string;
    }>;
  }>;
}

interface CardLike {
  id?: string;
  name?: string;
  price?: string;
  shortDescription?: string;
  imageUrl?: string;
}

type ProcessMessageFn = (payload: {
  channel: 'whatsapp';
  channel_user_id: string;
  text: string;
  phone?: string;
}) => Promise<{ reply: string; cards?: CardLike[] }>;

// ── Signature verification ───────────────────────────────────────────────────

function verifySignature(req: Request): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) return true; // skip verification if not configured

  const signature = req.headers['x-hub-signature-256'] as string | undefined;
  if (!signature) return false;

  const rawBody = (req as any).rawBody;
  if (!rawBody) return false;

  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

// ── Webhook verification (GET) ───────────────────────────────────────────────

export function createWhatsAppVerifyHandler() {
  return (req: Request, res: Response): void => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN ?? '';

    if (mode === 'subscribe' && token === verifyToken) {
      logInfo('WhatsApp webhook verified');
      res.status(200).send(challenge);
    } else {
      logError('WhatsApp webhook verification failed', { mode, token });
      res.sendStatus(403);
    }
  };
}

// ── Webhook handler (POST) ───────────────────────────────────────────────────

export function createWhatsAppWebhookHandler(processMessage: ProcessMessageFn) {
  return async (req: Request, res: Response): Promise<void> => {
    // Verify signature
    if (!verifySignature(req)) {
      res.sendStatus(403);
      return;
    }

    // Acknowledge immediately — WhatsApp requires a 200 quickly
    res.sendStatus(200);

    const body: WhatsAppWebhookPayload = req.body;

    if (body.object !== 'whatsapp_business_account') return;

    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field !== 'messages') continue;
        const messages = change.value.messages ?? [];

        for (const msg of messages) {
          // Only handle text messages for now
          const text = msg.text?.body?.trim() ?? msg.button?.text?.trim();
          if (!text) continue;

          const phone = msg.from; // sender's phone number
          logInfo('WhatsApp message', { phone, text: text.slice(0, 120) });

          try {
            // Mark as read (blue ticks)
            await markAsRead(msg.id).catch(() => {});

            // ── Link code handling ─────────────────────────────────────
            // If the message looks like a 6-char uppercase link code, try to consume it
            const maybeLinkCode = text.toUpperCase().trim();
            if (/^[A-Z0-9]{6}$/.test(maybeLinkCode)) {
              const linked = await consumeLinkCode(maybeLinkCode, phone);
              if (linked) {
                await sendWhatsAppMessage(
                  phone,
                  'Connected! Your web session is now linked to WhatsApp. You can continue your conversation here.'
                );
                const lastMsg = await getLastAssistantMessage(linked.customerId);
                if (lastMsg) {
                  await sendWhatsAppMessage(phone, lastMsg);
                }
                continue;
              }
              // Not a valid code — fall through to normal message processing
            }

            // ── Session check for greeting ───────────────────────────
            if (text.toLowerCase() === 'hi' || text.toLowerCase() === 'hello' || text.toLowerCase() === 'start') {
              const existing = await findCustomerByChannel('whatsapp', phone);
              if (existing) {
                // Already linked — just process as a normal message
              } else {
                // New user, no link — still process normally (will auto-create customer)
              }
            }

            // ── Normal message processing ────────────────────────────
            const result = await processMessage({
              channel: 'whatsapp',
              channel_user_id: phone,
              text,
              phone,
            });
            await sendWhatsAppMessage(phone, result.reply);
            await sendCards(phone, result.cards);
          } catch (err) {
            logError('WhatsApp webhook error', { phone, err });
            try {
              await sendWhatsAppMessage(phone, 'Something went wrong. Please try again.');
            } catch { /* ignore */ }
          }
        }
      }
    }
  };
}

async function sendCards(to: string, cards?: CardLike[]): Promise<void> {
  if (!cards?.length) return;
  for (const card of cards) {
    if (!card.id || !card.name) continue;
    try {
      await sendWhatsAppCard(to, {
        id: card.id,
        name: card.name,
        price: card.price,
        shortDescription: card.shortDescription,
        imageUrl: card.imageUrl,
      });
    } catch (err) {
      logError('Failed to send WhatsApp card', { to, cardId: card.id, err });
    }
  }
}
