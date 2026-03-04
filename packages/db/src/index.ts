import { PrismaClient, IntegrationProvider } from '@prisma/client';
import type { Channel, MessageDirection, Customer, Thread, Cart, CartItem, GroupOrderStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { getGroupOrderConfig } from './groupOrder/config';

// Prisma client singleton
const prisma = new PrismaClient();

export { prisma, IntegrationProvider };
export type { Channel, MessageDirection, Customer, Thread };

// ─── Group Order (New Algorithm) ───
export { addItemToGroupOrder } from './groupOrder/service';
export type { AddItemToGroupOrderInput, AddItemToGroupOrderResult } from './groupOrder/service';

// ─── Customer & Identity ───

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
    if (email && identity.customer.email !== email) updates.email = email;
    if (phone && identity.customer.phone !== phone) updates.phone = phone;

    if (Object.keys(updates).length > 0) {
      return prisma.customer.update({
        where: { id: identity.customer.id },
        data: updates
      });
    }
    return identity.customer;
  }

  return prisma.$transaction(async (tx) => {
    const customer = await tx.customer.create({
      data: {
        email: email ?? undefined,
        phone: phone ?? undefined,
        preferredChannel: channel
      }
    });
    await tx.channelIdentity.create({
      data: { customerId: customer.id, channel, channelUserId }
    });
    return customer;
  });
}

// ─── Thread & Messages ───

export async function getOrCreateForegroundThread(customerId: string): Promise<Thread> {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    include: { foregroundThread: true }
  });
  if (!customer) throw new Error(`Customer ${customerId} not found`);
  if (customer.foregroundThread) return customer.foregroundThread;

  const thread = await prisma.thread.create({
    data: { customerId, type: 'generic' }
  });
  await prisma.customer.update({
    where: { id: customerId },
    data: { foregroundThreadId: thread.id }
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
  const thread = await prisma.thread.findUnique({ where: { id: threadId } });
  if (!thread) throw new Error(`Thread ${threadId} not found`);
  const current = ((thread.contextJson as any) ?? {}) as Record<string, unknown>;
  return prisma.thread.update({
    where: { id: threadId },
    data: { contextJson: { ...current, ...patch } as any }
  });
}

export async function getRecentMessages(threadId: string, limit: number = 20) {
  return prisma.message.findMany({
    where: { threadId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: { direction: true, text: true, createdAt: true }
  });
}

// ─── CRM Link ───

export async function upsertCrmLink(params: {
  customerId: string;
  hubspotContactId?: string | null;
  hubspotDealId?: string | null;
  dealPipelineId?: string | null;
  dealStageId?: string | null;
  meta?: unknown;
}) {
  const { customerId, hubspotContactId, hubspotDealId, dealPipelineId, dealStageId, meta } = params;
  const existing = await prisma.crmLink.findFirst({
    where: { customerId, provider: IntegrationProvider.hubspot }
  });

  if (existing) {
    const data: any = {};
    if (hubspotContactId !== undefined) data.hubspotContactId = hubspotContactId;
    if (hubspotDealId !== undefined) data.hubspotDealId = hubspotDealId;
    if (dealPipelineId !== undefined) data.dealPipelineId = dealPipelineId;
    if (dealStageId !== undefined) data.dealStageId = dealStageId;
    if (meta !== undefined) data.meta = meta as any;
    if (Object.keys(data).length === 0) return existing;
    return prisma.crmLink.update({ where: { id: existing.id }, data });
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

// ─── Cart ───

export type CartWithItems = Cart & { items: CartItem[] };

export interface AddCartItemInput {
  productId: string;
  variantId?: string | null;
  name: string;
  imageUrl?: string | null;
  unitPrice: number;
  quantity?: number;
  metadata?: unknown;
}

export interface CartSummary {
  items: {
    id: string;
    productId: string;
    variantId: string | null;
    name: string;
    imageUrl: string | null;
    unitPrice: string;
    quantity: number;
    lineTotal: string;
  }[];
  subtotal: string;
  total: string;
  currency: string;
  itemCount: number;
}

async function ensureCart(customerId: string): Promise<Cart> {
  const existing = await prisma.cart.findUnique({ where: { customerId } });
  if (existing) return existing;
  return prisma.cart.create({ data: { customerId } });
}

export async function getOrCreateCart(customerId: string): Promise<CartWithItems> {
  const cart = await ensureCart(customerId);
  return prisma.cart.findUniqueOrThrow({ where: { id: cart.id }, include: { items: true } });
}

export async function addCartItem(customerId: string, input: AddCartItemInput): Promise<CartWithItems> {
  const cart = await ensureCart(customerId);
  const qty = input.quantity ?? 1;

  // Safety: reject invalid prices
  if (isNaN(input.unitPrice) || input.unitPrice < 0) {
    throw new Error(`Invalid unit price: ${input.unitPrice}`);
  }

  const existing = input.variantId
    ? await prisma.cartItem.findUnique({
        where: { cartId_productId_variantId: { cartId: cart.id, productId: input.productId, variantId: input.variantId } }
      })
    : await prisma.cartItem.findFirst({
        where: { cartId: cart.id, productId: input.productId, variantId: null }
      });

  if (existing) {
    await prisma.cartItem.update({
      where: { id: existing.id },
      data: { quantity: existing.quantity + qty, unitPrice: new Decimal(input.unitPrice), name: input.name, imageUrl: input.imageUrl ?? existing.imageUrl }
    });
  } else {
    await prisma.cartItem.create({
      data: {
        cartId: cart.id,
        productId: input.productId,
        variantId: input.variantId ?? undefined,
        name: input.name,
        imageUrl: input.imageUrl ?? null,
        unitPrice: new Decimal(input.unitPrice),
        quantity: qty,
        metadata: (input.metadata ?? null) as any
      }
    });
  }

  return prisma.cart.findUniqueOrThrow({ where: { id: cart.id }, include: { items: true } });
}

export async function updateCartItemQty(
  customerId: string, productId: string, quantity: number, variantId?: string | null
): Promise<CartWithItems> {
  const cart = await ensureCart(customerId);
  if (quantity <= 0) {
    await prisma.cartItem.deleteMany({ where: { cartId: cart.id, productId, variantId: variantId ?? null } });
  } else {
    await prisma.cartItem.updateMany({ where: { cartId: cart.id, productId, variantId: variantId ?? null }, data: { quantity } });
  }
  return prisma.cart.findUniqueOrThrow({ where: { id: cart.id }, include: { items: true } });
}

export async function removeCartItem(customerId: string, productId: string, variantId?: string | null): Promise<CartWithItems> {
  const cart = await ensureCart(customerId);
  await prisma.cartItem.deleteMany({ where: { cartId: cart.id, productId, variantId: variantId ?? null } });
  return prisma.cart.findUniqueOrThrow({ where: { id: cart.id }, include: { items: true } });
}

export async function clearCart(customerId: string): Promise<CartWithItems> {
  const cart = await ensureCart(customerId);
  await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
  return prisma.cart.findUniqueOrThrow({ where: { id: cart.id }, include: { items: true } });
}

export function computeCartSummary(cart: CartWithItems): CartSummary {
  const items = cart.items.map((item) => {
    const price = Number(item.unitPrice);
    const lineTotal = price * item.quantity;
    return {
      id: item.id, productId: item.productId, variantId: item.variantId,
      name: item.name, imageUrl: item.imageUrl,
      unitPrice: price.toFixed(2), quantity: item.quantity, lineTotal: lineTotal.toFixed(2)
    };
  });
  const subtotal = items.reduce((sum, i) => sum + Number(i.lineTotal), 0);
  return {
    items, subtotal: subtotal.toFixed(2), total: subtotal.toFixed(2),
    currency: cart.currency, itemCount: items.reduce((sum, i) => sum + i.quantity, 0)
  };
}

// ─── Group Orders ───

export interface GroupOrderFull {
  id: string;
  code: string;
  status: GroupOrderStatus;
  moqTarget: number;
  moqCurrent: number;
  moqSurfaces: number;
  surfaceMaxLayers: number | null;
  /** Manufacturer name (stored in DB as manufacturerId column) */
  manufacturer: string | null;
  expiresAt: Date | null;
  createdByCustomerId: string;
  participants: { customerId: string; createdAt: Date }[];
  items: { id: string; customerId: string; productId: string; variantId: string | null; name: string; imageUrl: string | null; unitPrice: string; quantity: number }[];
  participantCount: number;
  progress: {
    balancedLayers: number;
    totalBoxes: number;
    remainingToTarget: number;
    productLayers: {
      productId: string;
      quantity: number;
      boxesPerLayer: number;
      completedLayers: number;
      openedLayers: number;
    }[];
  };
  surfaces?: {
    surfaceIndex: number;
    maxLayers: number;
    status: string;
    layers: {
      layerIndex: number;
      productId: string;
      productName: string;
      variantId: string | null;
      capacityBoxes: number;
      capacityUnits: number;
      filledBoxes: number;
      filledUnits: number;
      status: string;
    }[];
  }[];
}

export interface AddGroupOrderItemInput {
  productId: string;
  variantId?: string | null;
  name: string;
  imageUrl?: string | null;
  unitPrice: number;
  quantity?: number;
  metadata?: unknown;
}

interface GroupOrderItemRuleMetadata {
  manufacturer?: string;
  boxesPerLayer?: number;
}

export interface DiscoverableGroupOrder {
  code: string;
  status: GroupOrderStatus;
  /** Manufacturer name (stored in DB as manufacturerId column) */
  manufacturer: string | null;
  moqTarget: number;
  moqCurrent: number;
  remainingToTarget: number;
  participantCount: number;
  expiresAt: Date | null;
  /** Number of surfaces opened (may be partial/incomplete) */
  surfacesOpened: number;
  /** Total boxes filled across all surfaces */
  totalBoxesFilled: number;
}

export interface DeleteGroupOrderResult {
  code: string;
  deleted: true;
  deletedAt: Date;
}

function generateGroupCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

export async function recalcMoq(groupOrderId: string): Promise<number> {
  const go = await prisma.groupOrder.findUnique({
    where: { id: groupOrderId },
    include: {
      items: {
        select: {
          productId: true,
          variantId: true,
          quantity: true,
          metadata: true
        }
      },
      surfaces: {
        include: {
          layers: true
        }
      }
    }
  });
  if (!go) return 0;

  // NEW: If surfaces/layers exist, calculate from new algorithm data
  if (go.surfaces && go.surfaces.length > 0) {
    const totalBoxes = go.surfaces.reduce((sum, surface) => {
      return sum + surface.layers.reduce((layerSum, layer) => layerSum + layer.filledBoxes, 0);
    }, 0);

    // For new algorithm, moqCurrent represents number of SURFACES filled (not boxes)
    // A surface is considered "filled" when it has at least one layer with boxes
    const filledSurfaces = go.surfaces.filter(surface => 
      surface.layers.some(layer => layer.filledBoxes > 0)
    ).length;
    
    const moqCurrent = filledSurfaces;

    console.log(`[recalcMoq] Calculating from surfaces/layers: groupOrderId=${groupOrderId}, totalBoxes=${totalBoxes}, surfaces=${go.surfaces.length}, filledSurfaces=${filledSurfaces}, moqCurrent=${moqCurrent}, moqTarget=${go.moqTarget}`);

    // Calculate progress metadata from surfaces/layers
    const productMap = new Map<string, { boxes: number; capacity: number }>();
    for (const surface of go.surfaces) {
      for (const layer of surface.layers) {
        const key = `${layer.productId}:${layer.variantId ?? ''}`;
        const existing = productMap.get(key);
        if (existing) {
          existing.boxes += layer.filledBoxes;
          existing.capacity += layer.capacityBoxes;
        } else {
          productMap.set(key, { boxes: layer.filledBoxes, capacity: layer.capacityBoxes });
        }
      }
    }

    const productLayers = Array.from(productMap.entries()).map(([key, data]) => {
      const [productId] = key.split(':');
      const boxesPerLayer = data.capacity / go.surfaces.reduce((count, s) => 
        count + s.layers.filter(l => `${l.productId}:${l.variantId ?? ''}` === key).length, 0
      ) || 1;
      return {
        productId,
        quantity: data.boxes,
        boxesPerLayer: Math.floor(boxesPerLayer),
        completedLayers: Math.floor(data.boxes / boxesPerLayer),
        openedLayers: Math.ceil(data.boxes / boxesPerLayer)
      };
    });

    const balancedLayers = productLayers.length === 0 ? 0 : Math.min(...productLayers.map(p => p.completedLayers));
    const progressMeta = {
      balancedLayers,
      totalBoxes: moqCurrent,
      remainingToTarget: Math.max(0, go.moqTarget - moqCurrent),
      productLayers
    };

    let newStatus: GroupOrderStatus = go.status;
    if (go.status === 'OPEN' && moqCurrent >= go.moqTarget) newStatus = 'MOQ_REACHED';
    else if (go.status === 'MOQ_REACHED' && moqCurrent < go.moqTarget) newStatus = 'OPEN';

    console.log(`[recalcMoq] Updating database: groupOrderId=${groupOrderId}, moqCurrent=${moqCurrent}, status=${newStatus}, progressMeta=`, progressMeta);

    await prisma.groupOrder.update({
      where: { id: groupOrderId },
      data: { moqCurrent, status: newStatus, meta: progressMeta as any }
    });

    console.log(`[recalcMoq] Database updated successfully: groupOrderId=${groupOrderId}, moqCurrent=${moqCurrent}`);
    return moqCurrent;
  }

  // OLD: Fallback to legacy items-based calculation
  const grouped = new Map<string, { productId: string; quantity: number; boxesPerLayer: number }>();
  for (const item of go.items) {
    const key = `${item.productId}:${item.variantId ?? ''}`;
    const meta = ((item.metadata as GroupOrderItemRuleMetadata | null) ?? {});
    const boxesPerLayerRaw = Number(meta.boxesPerLayer ?? 1);
    const boxesPerLayer = Number.isFinite(boxesPerLayerRaw) && boxesPerLayerRaw > 0
      ? Math.floor(boxesPerLayerRaw)
      : 1;

    const existing = grouped.get(key);
    if (existing) {
      existing.quantity += item.quantity;
    } else {
      grouped.set(key, { productId: item.productId, quantity: item.quantity, boxesPerLayer });
    }
  }

  const productLayers = Array.from(grouped.values()).map((entry) => {
    const completedLayers = Math.floor(entry.quantity / entry.boxesPerLayer);
    const openedLayers = Math.ceil(entry.quantity / entry.boxesPerLayer);
    return {
      productId: entry.productId,
      quantity: entry.quantity,
      boxesPerLayer: entry.boxesPerLayer,
      completedLayers,
      openedLayers
    };
  });

  // Rule implementation:
  // - One product: MOQ progress is live by quantity.
  // - Multiple products: progress follows the product with fewer completed layers.
  const moqCurrent = productLayers.length <= 1
    ? (productLayers[0]?.quantity ?? 0)
    : productLayers.reduce(
        (sum, p) => sum + (Math.min(...productLayers.map((x) => x.completedLayers)) * p.boxesPerLayer),
        0
      );

  const balancedLayers = productLayers.length === 0
    ? 0
    : Math.min(...productLayers.map((p) => p.completedLayers));
  const totalBoxes = productLayers.reduce((sum, p) => sum + p.quantity, 0);

  const progressMeta = {
    balancedLayers,
    totalBoxes,
    remainingToTarget: Math.max(0, go.moqTarget - moqCurrent),
    productLayers
  };

  let newStatus: GroupOrderStatus = go.status;
  if (go.status === 'OPEN' && moqCurrent >= go.moqTarget) newStatus = 'MOQ_REACHED';
  else if (go.status === 'MOQ_REACHED' && moqCurrent < go.moqTarget) newStatus = 'OPEN';

  await prisma.groupOrder.update({
    where: { id: groupOrderId },
    data: { moqCurrent, status: newStatus, meta: progressMeta as any }
  });
  return moqCurrent;
}

function checkExpiry(go: { id: string; status: GroupOrderStatus; expiresAt: Date | null }) {
  if (go.expiresAt && new Date() > go.expiresAt && (go.status === 'OPEN' || go.status === 'DRAFT')) {
    prisma.groupOrder.update({ where: { id: go.id }, data: { status: 'EXPIRED' } }).catch(() => {});
    (go as any).status = 'EXPIRED';
  }
}

export async function createGroupOrder(customerId: string, deadlineHours?: number): Promise<GroupOrderFull> {
  const config = getGroupOrderConfig();
  const code = generateGroupCode();
  const expiresAt = deadlineHours ? new Date(Date.now() + deadlineHours * 60 * 60 * 1000) : null;
  const created = await prisma.groupOrder.create({
    data: { 
      code, 
      createdByCustomerId: customerId, 
      status: 'OPEN', 
      moqSurfaces: config.defaultMoqSurfaces,
      moqTarget: config.defaultMoqSurfaces, // Set to match moqSurfaces for backward compatibility
      moqCurrent: 0, // DEPRECATED: kept for backward compatibility
      expiresAt 
    }
  });
  await prisma.groupOrderParticipant.create({
    data: { groupOrderId: created.id, customerId }
  });
  return getGroupOrderStatus(code);
}

export async function joinGroupOrder(code: string, customerId: string): Promise<GroupOrderFull> {
  const go = await prisma.groupOrder.findUnique({ where: { code } });
  if (!go) throw new Error(`Group order ${code} not found`);
  checkExpiry(go);
  if (go.status === 'EXPIRED') throw new Error(`Group order ${code} has expired`);
  if (go.status === 'CONFIRMED' || go.status === 'CHECKOUT_STARTED') throw new Error(`Group order ${code} is already in checkout/confirmed`);
  await prisma.groupOrderParticipant.upsert({
    where: { groupOrderId_customerId: { groupOrderId: go.id, customerId } },
    create: { groupOrderId: go.id, customerId },
    update: {}
  });
  return getGroupOrderStatus(code);
}

export async function leaveGroupOrder(code: string, customerId: string): Promise<GroupOrderFull> {
  const go = await prisma.groupOrder.findUnique({ where: { code } });
  if (!go) throw new Error(`Group order ${code} not found`);
  await prisma.groupOrderParticipant.deleteMany({ where: { groupOrderId: go.id, customerId } });
  await prisma.groupOrderItem.deleteMany({ where: { groupOrderId: go.id, customerId } });
  await recalcMoq(go.id);

  // Prevent orphan active orders: if no participants remain, mark as expired.
  // Cleanup policy will hard-delete expired orders.
  const participantsLeft = await prisma.groupOrderParticipant.count({ where: { groupOrderId: go.id } });
  if (participantsLeft === 0) {
    await prisma.groupOrder.update({
      where: { id: go.id },
      data: {
        status: 'EXPIRED',
        expiresAt: new Date(),
        meta: {
          ...(go.meta as Record<string, unknown> ?? {}),
          orphanedAt: new Date().toISOString(),
          orphanedReason: 'No participants left'
        } as any
      }
    });
  }

  return getGroupOrderStatus(code);
}

export async function deleteGroupOrderByCreator(code: string, actorCustomerId: string): Promise<DeleteGroupOrderResult> {
  const go = await prisma.groupOrder.findUnique({ where: { code } });
  if (!go) throw new Error(`Group order ${code} not found`);
  if (go.createdByCustomerId !== actorCustomerId) {
    throw new Error(`Only the group order creator can delete group order ${code}`);
  }
  await prisma.groupOrder.delete({ where: { id: go.id } });
  return { code, deleted: true, deletedAt: new Date() };
}

export async function addGroupOrderItem(code: string, customerId: string, input: AddGroupOrderItemInput): Promise<GroupOrderFull> {
  const go = await prisma.groupOrder.findUnique({ where: { code } });
  if (!go) throw new Error(`Group order ${code} not found`);
  checkExpiry(go);
  if (go.status === 'EXPIRED') throw new Error(`Group order ${code} has expired`);
  if (go.status === 'CHECKOUT_STARTED' || go.status === 'CONFIRMED') {
    throw new Error(`Group order ${code} is already in checkout/confirmed`);
  }
  const qty = input.quantity ?? 1;
  const itemMeta = ((input.metadata as GroupOrderItemRuleMetadata | null) ?? {});
  const manufacturer = itemMeta.manufacturer?.trim();
  if (!manufacturer) {
    throw new Error('Product is missing manufacturer metadata. Cannot add to a group order.');
  }

  if (go.manufacturerId && go.manufacturerId !== manufacturer) {
    throw new Error(`Group order ${code} is locked to manufacturer "${go.manufacturerId}".`);
  }

  const existing = await prisma.groupOrderItem.findFirst({
    where: { groupOrderId: go.id, customerId, productId: input.productId, variantId: input.variantId ?? null }
  });
  if (existing) {
    await prisma.groupOrderItem.update({ where: { id: existing.id }, data: { quantity: existing.quantity + qty } });
  } else {
    await prisma.groupOrderItem.create({
      data: {
        groupOrderId: go.id, customerId, productId: input.productId,
        variantId: input.variantId ?? null, name: input.name,
        imageUrl: input.imageUrl ?? null, unitPrice: new Decimal(input.unitPrice),
        quantity: qty, metadata: (input.metadata ?? null) as any
      }
    });
  }
  if (!go.manufacturerId) {
    await prisma.groupOrder.update({
      where: { id: go.id },
      data: {
        manufacturerId: manufacturer,
        constraintsJson: {
          manufacturer
        } as any
      }
    });
  }
  await recalcMoq(go.id);
  return getGroupOrderStatus(code);
}

export async function removeGroupOrderItem(code: string, customerId: string, productId: string): Promise<GroupOrderFull> {
  const go = await prisma.groupOrder.findUnique({ where: { code } });
  if (!go) throw new Error(`Group order ${code} not found`);
  await prisma.groupOrderItem.deleteMany({ where: { groupOrderId: go.id, customerId, productId } });
  await recalcMoq(go.id);
  return getGroupOrderStatus(code);
}

export async function getGroupOrderStatus(code: string): Promise<GroupOrderFull> {
  const go = await prisma.groupOrder.findUnique({
    where: { code },
    include: {
      participants: { select: { customerId: true, createdAt: true } },
      items: { select: { id: true, customerId: true, productId: true, variantId: true, name: true, imageUrl: true, unitPrice: true, quantity: true } },
      surfaces: {
        include: {
          layers: {
            orderBy: { layerIndex: 'asc' }
          }
        },
        orderBy: { surfaceIndex: 'asc' }
      }
    }
  });
  if (!go) throw new Error(`Group order ${code} not found`);
  checkExpiry(go);
  
  // Build enhanced progress with surface/layer details
  const progress = ((go.meta as GroupOrderFull['progress'] | null) ?? {
    balancedLayers: 0,
    totalBoxes: go.items.reduce((sum, i) => sum + i.quantity, 0),
    remainingToTarget: Math.max(0, go.moqTarget - go.moqCurrent),
    productLayers: []
  });

  // Calculate live moqCurrent from surfaces/layers (new algorithm)
  // moqCurrent = number of FULLY COMPLETED surfaces (status === 'full')
  const liveMoqCurrent = go.surfaces.length > 0
    ? go.surfaces.filter(s => s.status === 'full').length
    : go.moqCurrent;
  const moqTarget = go.moqSurfaces ?? go.moqTarget;

  // Create a map of productId -> product name from items
  const productNames = new Map<string, string>();
  for (const item of go.items) {
    const key = `${item.productId}:${item.variantId ?? ''}`;
    if (!productNames.has(key)) {
      productNames.set(key, item.name);
    }
  }

  // Add surface and layer information with product names
  const surfaceDetails = go.surfaces.map(surface => ({
    surfaceIndex: surface.surfaceIndex,
    maxLayers: surface.maxLayers,
    status: surface.status,
    layers: surface.layers.map(layer => {
      const key = `${layer.productId}:${layer.variantId ?? ''}`;
      return {
        layerIndex: layer.layerIndex,
        productId: layer.productId,
        productName: productNames.get(key) ?? layer.productId,
        variantId: layer.variantId,
        capacityBoxes: layer.capacityBoxes,
        capacityUnits: layer.capacityUnits,
        filledBoxes: layer.filledBoxes,
        filledUnits: layer.filledUnits,
        status: layer.status
      };
    })
  }));

  return {
    id: go.id, 
    code: go.code, 
    status: go.status, 
    moqTarget,
    moqCurrent: liveMoqCurrent,
    moqSurfaces: go.moqSurfaces,
    surfaceMaxLayers: go.surfaceMaxLayers,
    manufacturer: go.manufacturerId,
    expiresAt: go.expiresAt, 
    createdByCustomerId: go.createdByCustomerId,
    participants: go.participants,
    items: go.items.map((i) => ({ ...i, unitPrice: Number(i.unitPrice).toFixed(2) })),
    participantCount: go.participants.length,
    progress,
    surfaces: surfaceDetails
  };
}

export async function listDiscoverableGroupOrders(params?: {
  manufacturerId?: string;
  limit?: number;
}): Promise<DiscoverableGroupOrder[]> {
  // Keep discoverability clean by applying expiry/deletion policy before listing.
  await cleanupExpiredGroupOrders();

  const now = new Date();
  const limit = Math.max(1, Math.min(50, params?.limit ?? 10));
  const manufacturerId = params?.manufacturerId?.trim();

  const orders = await prisma.groupOrder.findMany({
    where: {
      status: { in: ['OPEN', 'MOQ_REACHED'] },
      ...(manufacturerId ? { manufacturerId } : {}),
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }]
    },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    take: limit,
    include: {
      participants: { select: { customerId: true } },
      surfaces: {
        include: { layers: { select: { filledBoxes: true } } }
      }
    }
  });

  return orders.map((go) => {
    // Calculate moqCurrent live from surfaces/layers if available (new algorithm)
    // moqCurrent = number of FULLY COMPLETED surfaces (all layers full)
    // A surface is complete when its status is 'full'
    const liveMoqCurrent = go.surfaces.length > 0
      ? go.surfaces.filter(s => s.status === 'full').length
      : go.moqCurrent;

    // moqTarget should match moqSurfaces (the real target in surfaces/pallets)
    const moqTarget = go.moqSurfaces ?? go.moqTarget;

    // Total boxes filled across all surfaces (for AI progress context)
    const totalBoxesFilled = go.surfaces.reduce((sum, s) =>
      sum + s.layers.reduce((ls, l) => ls + l.filledBoxes, 0), 0
    );

    return {
      code: go.code,
      status: go.status,
      manufacturer: go.manufacturerId,
      moqTarget,
      moqCurrent: liveMoqCurrent,
      remainingToTarget: Math.max(0, moqTarget - liveMoqCurrent),
      participantCount: go.participants.length,
      expiresAt: go.expiresAt,
      surfacesOpened: go.surfaces.length,
      totalBoxesFilled
    };
  });
}

export async function findBestGroupOrdersForManufacturer(params: {
  manufacturerId: string;
  limit?: number;
}): Promise<DiscoverableGroupOrder[]> {
  const manufacturerId = params.manufacturerId.trim();
  if (!manufacturerId) return [];

  const candidates = await listDiscoverableGroupOrders({
    manufacturerId,
    limit: Math.max(1, Math.min(50, params.limit ?? 20))
  });

  // Best first:
  // 1) MOQ already reached
  // 2) Lowest remaining to MOQ
  // 3) Higher participation
  return candidates
    .sort((a, b) => {
      const aReached = a.moqCurrent >= a.moqTarget ? 1 : 0;
      const bReached = b.moqCurrent >= b.moqTarget ? 1 : 0;
      if (aReached !== bReached) return bReached - aReached;
      if (a.remainingToTarget !== b.remainingToTarget) return a.remainingToTarget - b.remainingToTarget;
      return b.participantCount - a.participantCount;
    })
    .slice(0, Math.max(1, Math.min(10, params.limit ?? 3)));
}

export async function cleanupExpiredGroupOrders(params?: {
  deleteAfterHours?: number;
}): Promise<{ markedExpired: number; deleted: number }> {
  const now = new Date();
  const deleteAfterHours = params?.deleteAfterHours ?? 24;
  const hardDeleteBefore = new Date(now.getTime() - deleteAfterHours * 60 * 60 * 1000);

  // Step 1: auto-close orders that passed deadline.
  const mark = await prisma.groupOrder.updateMany({
    where: {
      status: { in: ['OPEN', 'DRAFT', 'MOQ_REACHED'] },
      expiresAt: { not: null, lt: now }
    },
    data: { status: 'EXPIRED' }
  });

  // Step 2: hard-delete expired orders that are old enough OR orphaned.
  const expired = await prisma.groupOrder.findMany({
    where: { status: 'EXPIRED' },
    include: {
      participants: { select: { customerId: true } }
    }
  });

  const deletableIds = expired
    .filter((go) => go.participants.length === 0 || (go.expiresAt !== null && go.expiresAt <= hardDeleteBefore))
    .map((go) => go.id);

  let deleted = 0;
  if (deletableIds.length > 0) {
    const result = await prisma.groupOrder.deleteMany({
      where: { id: { in: deletableIds } }
    });
    deleted = result.count;
  }

  return { markedExpired: mark.count, deleted };
}
