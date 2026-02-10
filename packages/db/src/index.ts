import { PrismaClient, IntegrationProvider } from '@prisma/client';
import type { Channel, MessageDirection, Customer, Thread } from '@prisma/client';

// Prisma client singleton
const prisma = new PrismaClient();

export { prisma, IntegrationProvider };
export type { Channel, MessageDirection, Customer, Thread };

export async function resolveCustomer(
  channel: Channel,
  channelUserId: string,
  email?: string | null,
  phone?: string | null
): Promise<Customer> {
  const identity = await prisma.channelIdentity.findUnique({
    where: {
      channel_channelUserId: {
        channel,
        channelUserId
      }
    },
    include: {
      customer: true
    }
  });

  if (identity?.customer) {
    const updates: Partial<Pick<Customer, 'email' | 'phone'>> = {};

    if (email && identity.customer.email !== email) {
      updates.email = email;
    }
    if (phone && identity.customer.phone !== phone) {
      updates.phone = phone;
    }

    if (Object.keys(updates).length > 0) {
      return prisma.customer.update({
        where: { id: identity.customer.id },
        data: updates
      });
    }

    return identity.customer;
  }

  // Create new customer + identity
  return prisma.$transaction(async (tx) => {
    const customer = await tx.customer.create({
      data: {
        email: email ?? undefined,
        phone: phone ?? undefined,
        preferredChannel: channel
      }
    });

    await tx.channelIdentity.create({
      data: {
        customerId: customer.id,
        channel,
        channelUserId
      }
    });

    return customer;
  });
}

export async function getOrCreateForegroundThread(customerId: string): Promise<Thread> {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    include: { foregroundThread: true }
  });

  if (!customer) {
    throw new Error(`Customer ${customerId} not found`);
  }

  if (customer.foregroundThread) {
    return customer.foregroundThread;
  }

  const thread = await prisma.thread.create({
    data: {
      customerId,
      type: 'generic'
    }
  });

  await prisma.customer.update({
    where: { id: customerId },
    data: {
      foregroundThreadId: thread.id
    }
  });

  return thread;
}

export interface AppendMessageInput {
  customerId: string;
  threadId?: string | null;
  channel: Channel;
  direction: MessageDirection;
  text?: string | null;
  traceId?: string | null;
  meta?: unknown;
}

export async function appendMessage(input: AppendMessageInput) {
  const { customerId, threadId, channel, direction, text, traceId, meta } = input;

  return prisma.message.create({
    data: {
      customerId,
      threadId: threadId ?? undefined,
      channel,
      direction,
      text: text ?? null,
      traceId: traceId ?? null,
      meta: (meta ?? null) as any
    }
  });
}

export async function updateThreadContext(
  threadId: string,
  patch: Record<string, unknown>
): Promise<Thread> {
  const thread = await prisma.thread.findUnique({
    where: { id: threadId }
  });

  if (!thread) {
    throw new Error(`Thread ${threadId} not found`);
  }

  const current = ((thread.contextJson as any) ?? {}) as Record<string, unknown>;

  const next = {
    ...current,
    ...patch
  };

  return prisma.thread.update({
    where: { id: threadId },
    data: {
      contextJson: next as any
    }
  });
}

export async function upsertCrmLink(params: {
  customerId: string;
  hubspotContactId?: string | null;
  hubspotDealId?: string | null;
  dealPipelineId?: string | null;
  dealStageId?: string | null;
  meta?: unknown;
}) {
  const {
    customerId,
    hubspotContactId,
    hubspotDealId,
    dealPipelineId,
    dealStageId,
    meta
  } = params;

  const existing = await prisma.crmLink.findFirst({
    where: {
      customerId,
      provider: IntegrationProvider.hubspot
    }
  });

  if (existing) {
    const data: any = {};
    if (hubspotContactId !== undefined) data.hubspotContactId = hubspotContactId;
    if (hubspotDealId !== undefined) data.hubspotDealId = hubspotDealId;
    if (dealPipelineId !== undefined) data.dealPipelineId = dealPipelineId;
    if (dealStageId !== undefined) data.dealStageId = dealStageId;
    if (meta !== undefined) data.meta = meta as any;

    if (Object.keys(data).length === 0) {
      return existing;
    }

    return prisma.crmLink.update({
      where: { id: existing.id },
      data
    });
  }

  return prisma.crmLink.create({
    data: {
      customerId,
      provider: IntegrationProvider.hubspot,
      hubspotContactId: hubspotContactId ?? null,
      hubspotDealId: hubspotDealId ?? null,
      dealPipelineId: dealPipelineId ?? null,
      dealStageId: dealStageId ?? null,
      meta: (meta ?? null) as any
    }
  });
}

