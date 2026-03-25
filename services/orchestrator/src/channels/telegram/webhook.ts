import type { Request, Response } from 'express';
import { consumeLinkCode } from '@taste-labs/db';
import { sendTelegramMessage, sendTelegramCard, answerCallbackQuery } from './sender';
import { logInfo, logError } from '../../logger';

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; first_name?: string; username?: string };
    chat: { id: number; type: string };
    text?: string;
  };
  callback_query?: {
    id: string;
    from: { id: number; first_name?: string; username?: string };
    message?: { chat: { id: number; type: string } };
    data?: string;
  };
}

interface CardLike {
  id?: string;
  name?: string;
  price?: string;
  shortDescription?: string;
  imageUrl?: string;
}

type ProcessMessageFn = (payload: {
  channel: 'telegram';
  channel_user_id: string;
  text: string;
}) => Promise<{ reply: string; cards?: CardLike[] }>;

/**
 * Factory that returns an Express route handler for POST /webhooks/telegram.
 * processMessage is injected to avoid circular imports with index.ts.
 */
export function createTelegramWebhookHandler(processMessage: ProcessMessageFn) {
  return async (req: Request, res: Response): Promise<void> => {
    // Verify optional webhook secret
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (secret && req.headers['x-telegram-bot-api-secret-token'] !== secret) {
      res.sendStatus(403);
      return;
    }

    // Acknowledge immediately — Telegram requires a 200 within a few seconds
    res.sendStatus(200);

    const update: TelegramUpdate = req.body;

    // ── Callback query (inline button tapped) ──────────────────────────────
    const cq = update.callback_query;
    if (cq?.data) {
      const chatId = String(cq.message?.chat?.id ?? cq.from.id);
      const [action, productId] = cq.data.split(':');
      try {
        await answerCallbackQuery(cq.id);

        let actionText: string;
        if (action === 'buy') {
          actionText = `Purchase [productId:${productId}]`;
        } else {
          actionText = `Show full details for [productId:${productId}]`;
        }

        const result = await processMessage({ channel: 'telegram', channel_user_id: chatId, text: actionText });
        await sendTelegramMessage(chatId, result.reply);
        await sendCards(chatId, result.cards);
      } catch (err) {
        logError('Telegram callback_query error', { chatId, err });
      }
      return;
    }

    // ── Regular message ────────────────────────────────────────────────────
    const msg = update.message;
    if (!msg?.text || !msg.chat?.id) return;

    const chatId = String(msg.chat.id);
    const text = msg.text.trim();

    logInfo('Telegram update', { chatId, text: text.slice(0, 120) });

    try {
      if (text.startsWith('/start')) {
        const code = text.split(' ')[1]?.trim();
        if (code) {
          const linked = await consumeLinkCode(code, chatId);
          if (linked) {
            await sendTelegramMessage(
              chatId,
              'Connected! Your web session is now linked to Telegram. You can continue your conversation here.'
            );
          } else {
            await sendTelegramMessage(
              chatId,
              'This code is invalid or has expired. Please generate a new one from the website.'
            );
          }
        } else {
          await sendTelegramMessage(
            chatId,
            "Hello! I'm the Taste Labs assistant.\n\nSend me a message to get started."
          );
        }
        return;
      }

      const result = await processMessage({ channel: 'telegram', channel_user_id: chatId, text });
      await sendTelegramMessage(chatId, result.reply);
      await sendCards(chatId, result.cards);
    } catch (err) {
      logError('Telegram webhook error', { chatId, err });
      try {
        await sendTelegramMessage(chatId, 'Something went wrong. Please try again.');
      } catch { /* ignore */ }
    }
  };
}

async function sendCards(chatId: string, cards?: CardLike[]): Promise<void> {
  if (!cards?.length) return;
  for (const card of cards) {
    if (!card.id || !card.name) continue;
    try {
      await sendTelegramCard(chatId, {
        id: card.id,
        name: card.name,
        price: card.price,
        shortDescription: card.shortDescription,
        imageUrl: card.imageUrl,
      });
    } catch (err) {
      logError('Failed to send Telegram card', { chatId, cardId: card.id, err });
    }
  }
}
