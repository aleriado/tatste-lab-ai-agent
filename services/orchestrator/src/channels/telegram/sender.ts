const TELEGRAM_API_BASE = 'https://api.telegram.org';

function getToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not configured');
  return token;
}

async function telegramPost(method: string, body: unknown): Promise<void> {
  const response = await fetch(`${TELEGRAM_API_BASE}/bot${getToken()}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Telegram API error ${response.status}: ${text}`);
  }
}

/**
 * Send a plain-text message to a Telegram chat.
 */
export async function sendTelegramMessage(
  chatId: string | number,
  text: string
): Promise<void> {
  await telegramPost('sendMessage', { chat_id: chatId, text });
}

export interface TelegramCardData {
  id: string;
  name: string;
  price?: string;
  shortDescription?: string;
  imageUrl?: string;
}

/**
 * Send a product card as a photo (or text if no image) with Purchase / Details
 * inline keyboard buttons. Purchase triggers a callback that adds to cart;
 * Details triggers a callback that fetches full product info.
 */
export async function sendTelegramCard(
  chatId: string | number,
  card: TelegramCardData
): Promise<void> {
  // Build caption: name in bold, price, short description (strip HTML tags)
  const plainDesc = (card.shortDescription ?? '')
    .replace(/<[^>]*>/g, '')
    .trim()
    .slice(0, 200);

  const captionParts = [
    `<b>${escapeHtml(card.name)}</b>`,
    card.price ? `₪${escapeHtml(card.price)}` : null,
    plainDesc || null,
  ].filter(Boolean);
  const caption = captionParts.join('\n');

  const replyMarkup = {
    inline_keyboard: [[
      { text: '🛒 Purchase', callback_data: `buy:${card.id}` },
      { text: 'ℹ️ Details',  callback_data: `dtl:${card.id}` },
    ]],
  };

  if (card.imageUrl) {
    await telegramPost('sendPhoto', {
      chat_id: chatId,
      photo: card.imageUrl,
      caption,
      parse_mode: 'HTML',
      reply_markup: replyMarkup,
    });
  } else {
    await telegramPost('sendMessage', {
      chat_id: chatId,
      text: caption,
      parse_mode: 'HTML',
      reply_markup: replyMarkup,
    });
  }
}

/**
 * Answer a callback query to dismiss Telegram's loading spinner.
 * Must be called within 10 seconds of receiving the callback.
 */
export async function answerCallbackQuery(
  callbackQueryId: string,
  text?: string
): Promise<void> {
  await telegramPost('answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    ...(text ? { text } : {}),
  });
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
