import type { Request, Response } from 'express';
import { consumeLinkCode } from '@taste-labs/db';
import { sendTelegramMessage } from './sender';
import { logInfo, logError } from '../../logger';

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; first_name?: string; username?: string };
    chat: { id: number; type: string };
    text?: string;
  };
}

type ProcessMessageFn = (payload: {
  channel: 'telegram';
  channel_user_id: string;
  text: string;
}) => Promise<{ reply: string }>;

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
            "Hello! I'm the Taste Labs AI assistant.\n\nTo link your web session, click \"Connect Telegram\" on the website and tap the link you receive."
          );
        }
        return;
      }

      const result = await processMessage({ channel: 'telegram', channel_user_id: chatId, text });
      await sendTelegramMessage(chatId, result.reply);
    } catch (err) {
      logError('Telegram webhook error', { chatId, err });
      try {
        await sendTelegramMessage(chatId, 'Something went wrong. Please try again.');
      } catch { /* ignore */ }
    }
  };
}
