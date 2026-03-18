/**
 * Import Order Service - Single-User Palette Orders
 *
 * Reuses the existing GroupOrder model with `isImport: true` and `maxParticipants: 1`.
 * Follows the same palette/surface/layer allocation rules as group orders
 * but restricts participation to the creating customer only.
 */

import { PrismaClient } from '@prisma/client';
import type { GroupOrderStatus } from '@prisma/client';
import { allocateToGroupOrder } from './allocation';
import { loadGroupOrderState, saveAllocationResult, recalcMoq, ensureParticipant } from './repository';
import { getImportOrderMoqSurfaces } from './config';
import type { ProductLogistics, AllocationResult } from './types';

/**
 * Import order status — mirrors the shared ImportOrderStatus interface.
 * Defined locally to avoid cross-package rootDir issues.
 */
export interface ImportOrderStatus {
  code: string;
  manufacturer: string;
  isImport: true;
  status: string;
  items: { productId: string; productName: string; quantity: number }[];
  paletteFill: {
    surfacesUsed: number;
    totalSurfaces: number;
    boxesFilled: number;
    totalBoxCapacity: number;
    percentFilled: number;
  };
  daysRemaining?: number;
}

const prisma = new PrismaClient();

// ── Helpers ──────────────────────────────────────────────────────────────────

function generateImportCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function checkExpiry(go: { id: string; status: GroupOrderStatus; expiresAt: Date | null }): void {
  if (go.status === 'EXPIRED') return;
  if (go.expiresAt && go.expiresAt < new Date() && go.status !== 'CONFIRMED' && go.status !== 'CHECKOUT_STARTED') {
    prisma.groupOrder.update({ where: { id: go.id }, data: { status: 'EXPIRED' } }).catch(() => {});
  }
}

// ── Result types ─────────────────────────────────────────────────────────────

export interface AddItemToImportOrderResult {
  success: boolean;
  allocatedBoxes: number;
  allocatedUnits: number;
  surfacesOpened: number;
  layersOpened: number;
  error?: {
    code: string;
    message: string;
    details: Record<string, unknown>;
  };
}

export interface CheckoutResult {
  success: boolean;
  code: string;
  status: string;
  error?: string;
}

// ── createImportOrder ────────────────────────────────────────────────────────

/**
 * Creates a new import order (GroupOrder with isImport=true, maxParticipants=1).
 */
export async function createImportOrder(
  customerId: string,
  deadlineHours?: number
): Promise<ImportOrderStatus> {
  const moqSurfaces = getImportOrderMoqSurfaces();
  const code = generateImportCode();
  const expiresAt = deadlineHours ? new Date(Date.now() + deadlineHours * 60 * 60 * 1000) : null;

  const created = await prisma.groupOrder.create({
    data: {
      code,
      createdByCustomerId: customerId,
      status: 'OPEN',
      orderType: 'IMPORT',
      isImport: true,
      maxParticipants: 1,
      moqSurfaces,
      moqTarget: moqSurfaces,
      moqCurrent: 0,
      expiresAt,
    },
  });

  await prisma.groupOrderParticipant.create({
    data: { groupOrderId: created.id, customerId },
  });

  return buildImportOrderStatus(created.code);
}

// ── getOpenImportOrders ──────────────────────────────────────────────────────

/**
 * Queries open import orders for a customer, optionally filtered by manufacturer.
 */
export async function getOpenImportOrders(
  customerId: string,
  manufacturerId?: string
): Promise<ImportOrderStatus[]> {
  const where: Record<string, unknown> = {
    createdByCustomerId: customerId,
    isImport: true,
    status: { in: ['OPEN', 'DRAFT', 'MOQ_REACHED'] as GroupOrderStatus[] },
  };
  if (manufacturerId) {
    where.manufacturerId = manufacturerId;
  }

  const orders = await prisma.groupOrder.findMany({
    where,
    include: {
      items: { select: { productId: true, name: true, quantity: true } },
      surfaces: {
        include: { layers: true },
        orderBy: { surfaceIndex: 'asc' as const },
      },
    },
    orderBy: { createdAt: 'desc' as const },
  });

  return orders.map((go) => mapToImportOrderStatus(go));
}

// ── addItemToImportOrder ─────────────────────────────────────────────────────

/** Same tier pricing as group orders: unitPrice + optional importPricePer2Boxes / importPricePerSurface. */
export interface AddItemToImportOrderPricing {
  productName: string;
  unitPrice: number;
  imageUrl: string | null;
  importPricePer2Boxes?: number;
  importPricePerSurface?: number;
}

/**
 * Adds an item to an import order. Validates single-user constraint,
 * then delegates to the existing allocateToGroupOrder engine.
 * Uses the same tier pricing as group orders (unitPrice / importPricePer2Boxes / importPricePerSurface).
 */
export async function addItemToImportOrder(
  code: string,
  customerId: string,
  product: ProductLogistics,
  quantityUnits: number,
  pricing: AddItemToImportOrderPricing
): Promise<AddItemToImportOrderResult> {
  try {
    // Load the group order and validate it's an import order
    const go = await prisma.groupOrder.findUnique({ where: { code } });
    if (!go) {
      return failResult('INVALID_STATE', `Import order ${code} not found`, { code });
    }

    if (!go.isImport) {
      return failResult('INVALID_STATE', `Order ${code} is not an import order`, { code });
    }

    // Enforce single-user constraint: only the creator can add items
    if (go.createdByCustomerId !== customerId) {
      return failResult('SINGLE_USER_VIOLATION', 
        `Import orders are single-user. Only the creator can add items. Consider creating a group order or a separate import order.`,
        { code, createdByCustomerId: go.createdByCustomerId, requestingCustomerId: customerId }
      );
    }

    // Check order status
    if (go.status === 'EXPIRED') {
      return failResult('INVALID_STATE', `Import order ${code} has expired`, { code });
    }
    if (go.status === 'CHECKOUT_STARTED' || go.status === 'CONFIRMED') {
      return failResult('INVALID_STATE', `Import order ${code} is already in checkout/confirmed`, { code });
    }

    checkExpiry(go);

    // Load current state and run allocation (reuses group order allocation engine)
    const state = await loadGroupOrderState(code);
    const result = allocateToGroupOrder(
      { groupOrderId: state.id, customerId, product, quantityUnits },
      state
    );

    if (!result.success) {
      console.log(`[import-order] Allocation failed: ${result.error?.code}`, {
        code, customerId, productId: product.productId, error: result.error,
      });
      return {
        success: false,
        allocatedBoxes: result.allocatedBoxes,
        allocatedUnits: result.allocatedUnits,
        surfacesOpened: result.surfacesOpened,
        layersOpened: result.layersOpened,
        error: result.error,
      };
    }

    // Save allocation result with same tier pricing as group orders (unitPrice / importPricePer2Boxes / importPricePerSurface)
    await saveAllocationResult(
      state.id,
      result,
      customerId,
      product.productId,
      product.variantId ?? null,
      pricing.productName,
      pricing.unitPrice,
      pricing.imageUrl,
      product.manufacturer,
      product.boxesPerLayer,
      product.unitsPerBox,
      product.layersPerSurface,
      pricing.importPricePer2Boxes,
      pricing.importPricePerSurface
    );

    await ensureParticipant(state.id, customerId);
    await recalcMoq(state.id);

    console.log(`[import-order] Allocation success`, {
      code, customerId, productId: product.productId,
      allocatedBoxes: result.allocatedBoxes,
      allocatedUnits: result.allocatedUnits,
    });

    return {
      success: true,
      allocatedBoxes: result.allocatedBoxes,
      allocatedUnits: result.allocatedUnits,
      surfacesOpened: result.surfacesOpened,
      layersOpened: result.layersOpened,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[import-order] Service error`, { code, customerId, error: message });
    return failResult('INVALID_STATE', message, { originalError: message });
  }
}

// ── getImportOrderStatus ─────────────────────────────────────────────────────

/**
 * Returns the import order status with palette fill progress.
 */
export async function getImportOrderStatus(code: string): Promise<ImportOrderStatus> {
  return buildImportOrderStatus(code);
}

// ── checkoutImportOrder ──────────────────────────────────────────────────────

/**
 * Validates and initiates checkout for an import order.
 */
export async function checkoutImportOrder(
  code: string,
  customerId: string
): Promise<CheckoutResult> {
  const go = await prisma.groupOrder.findUnique({
    where: { code },
    include: { items: true },
  });

  if (!go) {
    return { success: false, code, status: 'NOT_FOUND', error: `Import order ${code} not found` };
  }

  if (!go.isImport) {
    return { success: false, code, status: go.status, error: `Order ${code} is not an import order` };
  }

  if (go.createdByCustomerId !== customerId) {
    return { success: false, code, status: go.status, error: 'Only the creator can checkout an import order' };
  }

  if (go.status === 'EXPIRED') {
    return { success: false, code, status: 'EXPIRED', error: `Import order ${code} has expired` };
  }

  if (go.status === 'CHECKOUT_STARTED' || go.status === 'CONFIRMED') {
    return { success: false, code, status: go.status, error: `Import order ${code} is already in checkout/confirmed` };
  }

  if (go.items.length === 0) {
    return { success: false, code, status: go.status, error: 'Cannot checkout an empty import order' };
  }

  await prisma.groupOrder.update({
    where: { id: go.id },
    data: { status: 'CHECKOUT_STARTED' },
  });

  return { success: true, code, status: 'CHECKOUT_STARTED' };
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function failResult(
  errorCode: string,
  message: string,
  details: Record<string, unknown>
): AddItemToImportOrderResult {
  return {
    success: false,
    allocatedBoxes: 0,
    allocatedUnits: 0,
    surfacesOpened: 0,
    layersOpened: 0,
    error: { code: errorCode, message, details },
  };
}

/**
 * Builds the full ImportOrderStatus from a group order code.
 */
async function buildImportOrderStatus(code: string): Promise<ImportOrderStatus> {
  const go = await prisma.groupOrder.findUnique({
    where: { code },
    include: {
      items: { select: { productId: true, name: true, quantity: true } },
      surfaces: {
        include: { layers: true },
        orderBy: { surfaceIndex: 'asc' as const },
      },
    },
  });

  if (!go) throw new Error(`Import order ${code} not found`);

  return mapToImportOrderStatus(go);
}

/**
 * Maps a raw GroupOrder (with items + surfaces) to ImportOrderStatus.
 */
function mapToImportOrderStatus(go: {
  code: string;
  manufacturerId: string | null;
  isImport: boolean;
  status: GroupOrderStatus;
  expiresAt: Date | null;
  moqSurfaces: number;
  items: { productId: string; name: string; quantity: number }[];
  surfaces: {
    surfaceIndex: number;
    maxLayers: number;
    status: string;
    layers: {
      capacityBoxes: number;
      filledBoxes: number;
    }[];
  }[];
}): ImportOrderStatus {
  const totalSurfaces = go.moqSurfaces;
  const surfacesUsed = go.surfaces.length;

  let boxesFilled = 0;
  let totalBoxCapacity = 0;
  for (const surface of go.surfaces) {
    for (const layer of surface.layers) {
      boxesFilled += layer.filledBoxes;
      totalBoxCapacity += layer.capacityBoxes;
    }
  }

  // If no surfaces yet, estimate capacity from moqSurfaces
  if (totalBoxCapacity === 0 && totalSurfaces > 0) {
    totalBoxCapacity = 0; // Will be populated once items are added
  }

  const percentFilled = totalBoxCapacity > 0
    ? Math.round((boxesFilled / totalBoxCapacity) * 100)
    : 0;

  const daysRemaining = go.expiresAt
    ? Math.max(0, Math.ceil((go.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : undefined;

  return {
    code: go.code,
    manufacturer: go.manufacturerId ?? '',
    isImport: true,
    status: go.status,
    items: go.items.map((i) => ({
      productId: i.productId,
      productName: i.name,
      quantity: i.quantity,
    })),
    paletteFill: {
      surfacesUsed,
      totalSurfaces,
      boxesFilled,
      totalBoxCapacity,
      percentFilled,
    },
    daysRemaining,
  };
}
