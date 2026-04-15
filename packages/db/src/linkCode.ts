import { PrismaClient } from '@prisma/client';

// Module-level singleton — avoids circular dep with index.ts
const prisma = new PrismaClient();

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // excludes ambiguous I/1/O/0

function generateCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

const TTL_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Create a 15-minute link code for the given customer.
 * Returns the existing valid code if one already exists (prevents self-invalidation
 * when the button is clicked multiple times). Expired or used codes are cleaned up.
 */
export async function createLinkCode(
  customerId: string
): Promise<{ code: string; expiresAt: Date }> {
  // Clean up expired or used codes first
  await prisma.linkCode.deleteMany({
    where: {
      customerId,
      OR: [{ usedAt: { not: null } }, { expiresAt: { lt: new Date() } }],
    },
  });

  // Return existing valid code if present (avoid invalidating a code the user just received)
  const existing = await prisma.linkCode.findFirst({
    where: { customerId, usedAt: null, expiresAt: { gt: new Date() } },
  });
  if (existing) {
    return { code: existing.code, expiresAt: existing.expiresAt };
  }

  const expiresAt = new Date(Date.now() + TTL_MS);

  for (let attempt = 0; attempt < 10; attempt++) {
    const code = generateCode();
    try {
      await prisma.linkCode.create({ data: { customerId, code, expiresAt } });
      return { code, expiresAt };
    } catch {
      // Unique collision — retry with new code
    }
  }
  throw new Error('Failed to generate unique link code after 10 attempts');
}

/**
 * Consume a link code to link a Telegram user to the existing web customer.
 * Returns the customerId on success, null if code is invalid/expired/used.
 */
export async function consumeLinkCode(
  code: string,
  telegramUserId: string
): Promise<{ customerId: string } | null> {
  const record = await prisma.linkCode.findUnique({
    where: { code: code.toUpperCase().trim() },
  });

  if (!record || record.usedAt || record.expiresAt < new Date()) {
    return null;
  }

  await prisma.linkCode.update({
    where: { id: record.id },
    data: { usedAt: new Date() },
  });

  // Upsert the Telegram ChannelIdentity onto the existing customer
  await prisma.channelIdentity.upsert({
    where: {
      channel_channelUserId: {
        channel: 'telegram',
        channelUserId: telegramUserId,
      },
    },
    create: {
      customerId: record.customerId,
      channel: 'telegram',
      channelUserId: telegramUserId,
    },
    update: {
      customerId: record.customerId,
    },
  });

  return { customerId: record.customerId };
}
