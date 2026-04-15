const GRAPH_API_BASE = 'https://graph.facebook.com/v21.0';

function getPhoneNumberId(): string {
  const id = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!id) throw new Error('WHATSAPP_PHONE_NUMBER_ID is not configured');
  return id;
}

function getAccessToken(): string {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!token) throw new Error('WHATSAPP_ACCESS_TOKEN is not configured');
  return token;
}

async function whatsappPost(endpoint: string, body: unknown): Promise<unknown> {
  const response = await fetch(`${GRAPH_API_BASE}/${getPhoneNumberId()}/${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getAccessToken()}`,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`WhatsApp API error ${response.status}: ${text}`);
  }
  return response.json();
}

/**
 * Send a plain-text message to a WhatsApp user.
 */
export async function sendWhatsAppMessage(
  to: string,
  text: string
): Promise<void> {
  await whatsappPost('messages', {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { body: text },
  });
}

export interface WhatsAppCardData {
  id: string;
  name: string;
  price?: string;
  shortDescription?: string;
  imageUrl?: string;
}

/**
 * Send a product card as an image with caption, or plain text if no image.
 * WhatsApp doesn't support inline keyboards like Telegram, so we append
 * action hints the user can type (e.g. "Purchase" / "Details").
 */
export async function sendWhatsAppCard(
  to: string,
  card: WhatsAppCardData
): Promise<void> {
  const plainDesc = (card.shortDescription ?? '')
    .replace(/<[^>]*>/g, '')
    .trim()
    .slice(0, 200);

  const captionParts = [
    `*${card.name}*`,
    card.price ? `Price: ${card.price}` : null,
    plainDesc || null,
    '',
    `Reply "Purchase ${card.name}" or "Details ${card.name}"`,
  ].filter((p) => p !== null);
  const caption = captionParts.join('\n');

  if (card.imageUrl) {
    await whatsappPost('messages', {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'image',
      image: { link: card.imageUrl, caption },
    });
  } else {
    await sendWhatsAppMessage(to, caption);
  }
}

/**
 * Mark an incoming message as read (double blue ticks).
 */
export async function markAsRead(messageId: string): Promise<void> {
  await whatsappPost('messages', {
    messaging_product: 'whatsapp',
    status: 'read',
    message_id: messageId,
  });
}
