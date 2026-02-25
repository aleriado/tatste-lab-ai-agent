"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IntegrationProvider = exports.prisma = void 0;
exports.resolveCustomer = resolveCustomer;
exports.getOrCreateForegroundThread = getOrCreateForegroundThread;
exports.appendMessage = appendMessage;
exports.updateThreadContext = updateThreadContext;
exports.getRecentMessages = getRecentMessages;
exports.upsertCrmLink = upsertCrmLink;
exports.getOrCreateCart = getOrCreateCart;
exports.addCartItem = addCartItem;
exports.updateCartItemQty = updateCartItemQty;
exports.removeCartItem = removeCartItem;
exports.clearCart = clearCart;
exports.computeCartSummary = computeCartSummary;
exports.createGroupOrder = createGroupOrder;
exports.joinGroupOrder = joinGroupOrder;
exports.leaveGroupOrder = leaveGroupOrder;
exports.addGroupOrderItem = addGroupOrderItem;
exports.removeGroupOrderItem = removeGroupOrderItem;
exports.getGroupOrderStatus = getGroupOrderStatus;
const client_1 = require("@prisma/client");
Object.defineProperty(exports, "IntegrationProvider", { enumerable: true, get: function () { return client_1.IntegrationProvider; } });
const library_1 = require("@prisma/client/runtime/library");
// Prisma client singleton
const prisma = new client_1.PrismaClient();
exports.prisma = prisma;
// ─── Customer & Identity ───
async function resolveCustomer(channel, channelUserId, email, phone) {
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
        const updates = {};
        if (email && identity.customer.email !== email)
            updates.email = email;
        if (phone && identity.customer.phone !== phone)
            updates.phone = phone;
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
async function getOrCreateForegroundThread(customerId) {
    const customer = await prisma.customer.findUnique({
        where: { id: customerId },
        include: { foregroundThread: true }
    });
    if (!customer)
        throw new Error(`Customer ${customerId} not found`);
    if (customer.foregroundThread)
        return customer.foregroundThread;
    const thread = await prisma.thread.create({
        data: { customerId, type: 'generic' }
    });
    await prisma.customer.update({
        where: { id: customerId },
        data: { foregroundThreadId: thread.id }
    });
    return thread;
}
async function appendMessage(input) {
    const { customerId, threadId, channel, direction, text, traceId, meta } = input;
    return prisma.message.create({
        data: {
            customerId,
            threadId: threadId ?? undefined,
            channel,
            direction,
            text: text ?? null,
            traceId: traceId ?? null,
            meta: (meta ?? null)
        }
    });
}
async function updateThreadContext(threadId, patch) {
    const thread = await prisma.thread.findUnique({ where: { id: threadId } });
    if (!thread)
        throw new Error(`Thread ${threadId} not found`);
    const current = (thread.contextJson ?? {});
    return prisma.thread.update({
        where: { id: threadId },
        data: { contextJson: { ...current, ...patch } }
    });
}
async function getRecentMessages(threadId, limit = 20) {
    return prisma.message.findMany({
        where: { threadId },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: { direction: true, text: true, createdAt: true }
    });
}
// ─── CRM Link ───
async function upsertCrmLink(params) {
    const { customerId, hubspotContactId, hubspotDealId, dealPipelineId, dealStageId, meta } = params;
    const existing = await prisma.crmLink.findFirst({
        where: { customerId, provider: client_1.IntegrationProvider.hubspot }
    });
    if (existing) {
        const data = {};
        if (hubspotContactId !== undefined)
            data.hubspotContactId = hubspotContactId;
        if (hubspotDealId !== undefined)
            data.hubspotDealId = hubspotDealId;
        if (dealPipelineId !== undefined)
            data.dealPipelineId = dealPipelineId;
        if (dealStageId !== undefined)
            data.dealStageId = dealStageId;
        if (meta !== undefined)
            data.meta = meta;
        if (Object.keys(data).length === 0)
            return existing;
        return prisma.crmLink.update({ where: { id: existing.id }, data });
    }
    return prisma.crmLink.create({
        data: {
            customerId,
            provider: client_1.IntegrationProvider.hubspot,
            hubspotContactId: hubspotContactId ?? null,
            hubspotDealId: hubspotDealId ?? null,
            dealPipelineId: dealPipelineId ?? null,
            dealStageId: dealStageId ?? null,
            meta: (meta ?? null)
        }
    });
}
async function ensureCart(customerId) {
    const existing = await prisma.cart.findUnique({ where: { customerId } });
    if (existing)
        return existing;
    return prisma.cart.create({ data: { customerId } });
}
async function getOrCreateCart(customerId) {
    const cart = await ensureCart(customerId);
    return prisma.cart.findUniqueOrThrow({ where: { id: cart.id }, include: { items: true } });
}
async function addCartItem(customerId, input) {
    const cart = await ensureCart(customerId);
    const qty = input.quantity ?? 1;
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
            data: { quantity: existing.quantity + qty, unitPrice: new library_1.Decimal(input.unitPrice), name: input.name, imageUrl: input.imageUrl ?? existing.imageUrl }
        });
    }
    else {
        await prisma.cartItem.create({
            data: {
                cartId: cart.id,
                productId: input.productId,
                variantId: input.variantId ?? undefined,
                name: input.name,
                imageUrl: input.imageUrl ?? null,
                unitPrice: new library_1.Decimal(input.unitPrice),
                quantity: qty,
                metadata: (input.metadata ?? null)
            }
        });
    }
    return prisma.cart.findUniqueOrThrow({ where: { id: cart.id }, include: { items: true } });
}
async function updateCartItemQty(customerId, productId, quantity, variantId) {
    const cart = await ensureCart(customerId);
    if (quantity <= 0) {
        await prisma.cartItem.deleteMany({ where: { cartId: cart.id, productId, variantId: variantId ?? null } });
    }
    else {
        await prisma.cartItem.updateMany({ where: { cartId: cart.id, productId, variantId: variantId ?? null }, data: { quantity } });
    }
    return prisma.cart.findUniqueOrThrow({ where: { id: cart.id }, include: { items: true } });
}
async function removeCartItem(customerId, productId, variantId) {
    const cart = await ensureCart(customerId);
    await prisma.cartItem.deleteMany({ where: { cartId: cart.id, productId, variantId: variantId ?? null } });
    return prisma.cart.findUniqueOrThrow({ where: { id: cart.id }, include: { items: true } });
}
async function clearCart(customerId) {
    const cart = await ensureCart(customerId);
    await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
    return prisma.cart.findUniqueOrThrow({ where: { id: cart.id }, include: { items: true } });
}
function computeCartSummary(cart) {
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
function generateGroupCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++)
        code += chars[Math.floor(Math.random() * chars.length)];
    return code;
}
async function recalcMoq(groupOrderId) {
    const result = await prisma.groupOrderItem.aggregate({ where: { groupOrderId }, _sum: { quantity: true } });
    const moqCurrent = result._sum.quantity ?? 0;
    const go = await prisma.groupOrder.findUnique({ where: { id: groupOrderId } });
    if (!go)
        return moqCurrent;
    let newStatus = go.status;
    if (go.status === 'OPEN' && moqCurrent >= go.moqTarget)
        newStatus = 'MOQ_REACHED';
    else if (go.status === 'MOQ_REACHED' && moqCurrent < go.moqTarget)
        newStatus = 'OPEN';
    await prisma.groupOrder.update({ where: { id: groupOrderId }, data: { moqCurrent, status: newStatus } });
    return moqCurrent;
}
function checkExpiry(go) {
    if (go.expiresAt && new Date() > go.expiresAt && (go.status === 'OPEN' || go.status === 'DRAFT')) {
        prisma.groupOrder.update({ where: { id: go.id }, data: { status: 'EXPIRED' } }).catch(() => { });
        go.status = 'EXPIRED';
    }
}
async function createGroupOrder(customerId, moqTarget, deadlineHours) {
    const code = generateGroupCode();
    const expiresAt = deadlineHours ? new Date(Date.now() + deadlineHours * 60 * 60 * 1000) : null;
    await prisma.groupOrder.create({
        data: { code, createdByCustomerId: customerId, status: 'OPEN', moqTarget, moqCurrent: 0, expiresAt }
    });
    await prisma.groupOrderParticipant.create({
        data: { groupOrderId: (await prisma.groupOrder.findUnique({ where: { code } })).id, customerId }
    });
    return getGroupOrderStatus(code);
}
async function joinGroupOrder(code, customerId) {
    const go = await prisma.groupOrder.findUnique({ where: { code } });
    if (!go)
        throw new Error(`Group order ${code} not found`);
    checkExpiry(go);
    if (go.status === 'EXPIRED')
        throw new Error(`Group order ${code} has expired`);
    if (go.status === 'CONFIRMED' || go.status === 'CHECKOUT_STARTED')
        throw new Error(`Group order ${code} is already in checkout/confirmed`);
    await prisma.groupOrderParticipant.upsert({
        where: { groupOrderId_customerId: { groupOrderId: go.id, customerId } },
        create: { groupOrderId: go.id, customerId },
        update: {}
    });
    return getGroupOrderStatus(code);
}
async function leaveGroupOrder(code, customerId) {
    const go = await prisma.groupOrder.findUnique({ where: { code } });
    if (!go)
        throw new Error(`Group order ${code} not found`);
    await prisma.groupOrderParticipant.deleteMany({ where: { groupOrderId: go.id, customerId } });
    await prisma.groupOrderItem.deleteMany({ where: { groupOrderId: go.id, customerId } });
    await recalcMoq(go.id);
    return getGroupOrderStatus(code);
}
async function addGroupOrderItem(code, customerId, input) {
    const go = await prisma.groupOrder.findUnique({ where: { code } });
    if (!go)
        throw new Error(`Group order ${code} not found`);
    checkExpiry(go);
    if (go.status === 'EXPIRED')
        throw new Error(`Group order ${code} has expired`);
    const qty = input.quantity ?? 1;
    const existing = await prisma.groupOrderItem.findFirst({
        where: { groupOrderId: go.id, customerId, productId: input.productId, variantId: input.variantId ?? null }
    });
    if (existing) {
        await prisma.groupOrderItem.update({ where: { id: existing.id }, data: { quantity: existing.quantity + qty } });
    }
    else {
        await prisma.groupOrderItem.create({
            data: {
                groupOrderId: go.id, customerId, productId: input.productId,
                variantId: input.variantId ?? null, name: input.name,
                imageUrl: input.imageUrl ?? null, unitPrice: new library_1.Decimal(input.unitPrice),
                quantity: qty, metadata: (input.metadata ?? null)
            }
        });
    }
    await recalcMoq(go.id);
    return getGroupOrderStatus(code);
}
async function removeGroupOrderItem(code, customerId, productId) {
    const go = await prisma.groupOrder.findUnique({ where: { code } });
    if (!go)
        throw new Error(`Group order ${code} not found`);
    await prisma.groupOrderItem.deleteMany({ where: { groupOrderId: go.id, customerId, productId } });
    await recalcMoq(go.id);
    return getGroupOrderStatus(code);
}
async function getGroupOrderStatus(code) {
    const go = await prisma.groupOrder.findUnique({
        where: { code },
        include: {
            participants: { select: { customerId: true, createdAt: true } },
            items: { select: { id: true, customerId: true, productId: true, variantId: true, name: true, imageUrl: true, unitPrice: true, quantity: true } }
        }
    });
    if (!go)
        throw new Error(`Group order ${code} not found`);
    checkExpiry(go);
    return {
        id: go.id, code: go.code, status: go.status, moqTarget: go.moqTarget, moqCurrent: go.moqCurrent,
        expiresAt: go.expiresAt, createdByCustomerId: go.createdByCustomerId,
        participants: go.participants,
        items: go.items.map((i) => ({ ...i, unitPrice: Number(i.unitPrice).toFixed(2) })),
        participantCount: go.participants.length
    };
}
