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

/**
 * Send a single photo with an optional caption.
 */
export async function sendTelegramPhoto(
  chatId: string | number,
  imageUrl: string,
  caption?: string
): Promise<void> {
  await telegramPost('sendPhoto', { chat_id: chatId, photo: imageUrl, caption });
}

/**
 * Send up to 10 images as a media group (album).
 * Each item can have an optional caption shown under its photo.
 */
export async function sendTelegramMediaGroup(
  chatId: string | number,
  items: { imageUrl: string; caption?: string }[]
): Promise<void> {
  const media = items.slice(0, 10).map((item, i) => ({
    type: 'photo',
    media: item.imageUrl,
    // Telegram only shows caption on the first item of a group
    ...(i === 0 && item.caption ? { caption: item.caption } : {}),
  }));
  await telegramPost('sendMediaGroup', { chat_id: chatId, media });
}
