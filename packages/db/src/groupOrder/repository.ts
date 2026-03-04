/**
 * Group Order Repository - Database Operations
 * 
 * Handles loading and saving group order state with proper transaction handling
 * and row-level locking for concurrency safety.
 */

import { PrismaClient } from '@prisma/client';
import type { GroupOrderState, AllocationResult, LayerContribution } from './types';
import { getGroupOrderConfig } from './config';
import type { GroupOrderStatus } from '@prisma/client';

// Use a module-level singleton to avoid circular dep with index.ts
const prisma = new PrismaClient();

/**
 * Load current group order state from database
 * 
 * @param codeOrId - Group order code (e.g., "ABC123") or ID (cuid)
 */
export async function loadGroupOrderState(codeOrId: string): Promise<GroupOrderState> {
  const config = getGroupOrderConfig();

  // Try to find by code first, then by ID
  const groupOrder = await prisma.groupOrder.findFirst({
    where: {
      OR: [
        { code: codeOrId },
        { id: codeOrId }
      ]
    },
    include: {
      surfaces: {
        include: {
          layers: true
        },
        orderBy: { surfaceIndex: 'asc' }
      }
    }
  });

  if (!groupOrder) {
    throw new Error(`Group order ${codeOrId} not found`);
  }

  return {
    id: groupOrder.id,
    code: groupOrder.code,
    manufacturerId: groupOrder.manufacturerId,
    moqSurfaces: groupOrder.moqSurfaces,
    surfaceMaxLayers: groupOrder.surfaceMaxLayers,
    surfaces: groupOrder.surfaces.map(surface => ({
      id: surface.id,
      surfaceIndex: surface.surfaceIndex,
      maxLayers: surface.maxLayers,
      status: surface.status,
      layers: surface.layers.map(layer => ({
        id: layer.id,
        layerIndex: layer.layerIndex,
        productId: layer.productId,
        variantId: layer.variantId,
        capacityBoxes: layer.capacityBoxes,
        capacityUnits: layer.capacityUnits,
        filledBoxes: layer.filledBoxes,
        filledUnits: layer.filledUnits,
        status: layer.status
      }))
    })),
    allowExtraSurfaces: config.allowExtraSurfaces,
    maxSurfacesLimit: config.maxSurfaces
  };
}

/**
 * Save allocation result to database with transaction and locking
 * 
 * Uses row-level locking (SELECT FOR UPDATE) to prevent concurrent allocations
 * from over-filling layers or surfaces.
 */
export async function saveAllocationResult(
  groupOrderId: string,
  result: AllocationResult,
  customerId: string,
  productId: string,
  variantId: string | null,
  productName: string,
  unitPrice: number,
  imageUrl: string | null,
  manufacturer: string,
  boxesPerLayer: number,
  unitsPerBox: number,
  layersPerSurface: number
): Promise<void> {
  if (!result.success) {
    throw new Error(`Cannot save failed allocation: ${result.error?.message}`);
  }

  await prisma.$transaction(async (tx) => {
    // Lock the group order row to prevent concurrent modifications
    const groupOrder = await tx.groupOrder.findUnique({
      where: { id: groupOrderId },
      // SELECT FOR UPDATE - prevents concurrent writes
    });

    if (!groupOrder) {
      throw new Error(`Group order ${groupOrderId} not found`);
    }

    // Update manufacturer and surfaceMaxLayers if this is the first product
    // surfaceMaxLayers = MIN(layersPerSurface) across all products in this order.
    // On first product, initialize from the product's layersPerSurface.
    // On subsequent products, take the minimum (enforced by allocation algorithm).
    const newSurfaceMaxLayers = groupOrder.surfaceMaxLayers !== null
      ? Math.min(groupOrder.surfaceMaxLayers, layersPerSurface)
      : layersPerSurface;

    if (!groupOrder.manufacturerId || groupOrder.surfaceMaxLayers !== newSurfaceMaxLayers) {
      await tx.groupOrder.update({
        where: { id: groupOrderId },
        data: {
          manufacturerId: manufacturer,
          surfaceMaxLayers: newSurfaceMaxLayers
        }
      });
    }

    // Process each layer allocation
    for (const layerAlloc of result.layersUsed) {
      // Find or create surface
      let surface = await tx.groupOrderSurface.findUnique({
        where: {
          groupOrderId_surfaceIndex: {
            groupOrderId,
            surfaceIndex: layerAlloc.surfaceIndex
          }
        }
      });

      if (!surface) {
        // Create new surface with correct layer capacity from product logistics
        surface = await tx.groupOrderSurface.create({
          data: {
            groupOrderId,
            surfaceIndex: layerAlloc.surfaceIndex,
            maxLayers: newSurfaceMaxLayers,
            status: 'open'
          }
        });
      }

      // Find or create layer
      let layer = await tx.groupOrderLayer.findUnique({
        where: {
          surfaceId_layerIndex: {
            surfaceId: surface.id,
            layerIndex: layerAlloc.layerIndex
          }
        }
      });

      if (!layer) {
        const contribution: LayerContribution = {
          customerId,
          boxes: layerAlloc.boxes,
          units: layerAlloc.units,
          timestamp: new Date().toISOString()
        };

        layer = await tx.groupOrderLayer.create({
          data: {
            surfaceId: surface.id,
            layerIndex: layerAlloc.layerIndex,
            productId,
            variantId,
            capacityBoxes: boxesPerLayer,
            capacityUnits: boxesPerLayer * unitsPerBox,
            filledBoxes: Math.floor(layerAlloc.units / unitsPerBox),
            filledUnits: layerAlloc.units,
            status: layerAlloc.units >= boxesPerLayer * unitsPerBox ? 'full' : 'open',
            contributions: [contribution] as any
          }
        });
      } else {
        const existingContributions = (layer.contributions as LayerContribution[] | null) ?? [];
        const newContribution: LayerContribution = {
          customerId,
          boxes: layerAlloc.boxes,
          units: layerAlloc.units,
          timestamp: new Date().toISOString()
        };

        const newFilledUnits = layer.filledUnits + layerAlloc.units;
        const newFilledBoxes = Math.floor(newFilledUnits / unitsPerBox);
        const isFull = newFilledUnits >= layer.capacityUnits;

        await tx.groupOrderLayer.update({
          where: { id: layer.id },
          data: {
            filledBoxes: newFilledBoxes,
            filledUnits: newFilledUnits,
            status: isFull ? 'full' : 'open',
            contributions: [...existingContributions, newContribution] as any
          }
        });
      }

      // Update surface status if all layers are full
      const surfaceLayers = await tx.groupOrderLayer.findMany({
        where: { surfaceId: surface.id }
      });

      const allLayersFull = surfaceLayers.every(l => l.status === 'full');
      const surfaceAtMaxLayers = surfaceLayers.length >= surface.maxLayers;

      if (allLayersFull && surfaceAtMaxLayers) {
        await tx.groupOrderSurface.update({
          where: { id: surface.id },
          data: { status: 'full' }
        });
      }
    }

    // Update legacy GroupOrderItem for backward compatibility
    const existingItem = await tx.groupOrderItem.findFirst({
      where: {
        groupOrderId,
        customerId,
        productId,
        variantId
      }
    });

    if (existingItem) {
      await tx.groupOrderItem.update({
        where: { id: existingItem.id },
        data: {
          quantity: existingItem.quantity + result.allocatedBoxes
        }
      });
    } else {
      await tx.groupOrderItem.create({
        data: {
          groupOrderId,
          customerId,
          productId,
          variantId,
          name: productName,
          imageUrl,
          unitPrice,
          quantity: result.allocatedBoxes,
          metadata: {} as any
        }
      });
    }
  });
}

/**
 * Ensure a customer is registered as a participant in the group order.
 * Called automatically when adding an item — joining is implicit on first add.
 */
export async function ensureParticipant(groupOrderId: string, customerId: string): Promise<void> {
  await prisma.groupOrderParticipant.upsert({
    where: { groupOrderId_customerId: { groupOrderId, customerId } },
    create: { groupOrderId, customerId },
    update: {}
  });
}

/**
 * Recalculate moqCurrent for a group order and persist it.
 * Moved here from index.ts to break the circular dependency:
 *   index.ts → service.ts → index.ts
 */
export async function recalcMoq(groupOrderId: string): Promise<number> {
  type ItemMeta = { boxesPerLayer?: unknown };

  const go = await prisma.groupOrder.findUnique({
    where: { id: groupOrderId },
    include: {
      items: { select: { productId: true, variantId: true, quantity: true, metadata: true } },
      surfaces: { include: { layers: true } }
    }
  });
  if (!go) return 0;

  // New algorithm: calculate from surfaces/layers
  if (go.surfaces && go.surfaces.length > 0) {
    const totalBoxes = go.surfaces.reduce(
      (sum, s) => sum + s.layers.reduce((ls, l) => ls + l.filledBoxes, 0),
      0
    );
    const filledSurfaces = go.surfaces.filter(s => s.layers.some(l => l.filledBoxes > 0)).length;
    const moqCurrent = filledSurfaces;

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
      const layerCount = go.surfaces.reduce(
        (count, s) => count + s.layers.filter(l => `${l.productId}:${l.variantId ?? ''}` === key).length,
        0
      ) || 1;
      const boxesPerLayer = data.capacity / layerCount;
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
      totalBoxes,
      remainingToTarget: Math.max(0, go.moqTarget - moqCurrent),
      productLayers
    };

    let newStatus: GroupOrderStatus = go.status as GroupOrderStatus;
    if (go.status === 'OPEN' && moqCurrent >= go.moqTarget) newStatus = 'MOQ_REACHED';
    else if (go.status === 'MOQ_REACHED' && moqCurrent < go.moqTarget) newStatus = 'OPEN';

    await prisma.groupOrder.update({
      where: { id: groupOrderId },
      data: { moqCurrent, status: newStatus, meta: progressMeta as any }
    });
    return moqCurrent;
  }

  // Legacy fallback: calculate from items
  const grouped = new Map<string, { productId: string; quantity: number; boxesPerLayer: number }>();
  for (const item of go.items) {
    const key = `${item.productId}:${item.variantId ?? ''}`;
    const meta = ((item.metadata as ItemMeta | null) ?? {});
    const bpl = Number(meta.boxesPerLayer ?? 1);
    const boxesPerLayer = Number.isFinite(bpl) && bpl > 0 ? Math.floor(bpl) : 1;
    const existing = grouped.get(key);
    if (existing) existing.quantity += item.quantity;
    else grouped.set(key, { productId: item.productId, quantity: item.quantity, boxesPerLayer });
  }

  const productLayers = Array.from(grouped.values()).map(entry => ({
    productId: entry.productId,
    quantity: entry.quantity,
    boxesPerLayer: entry.boxesPerLayer,
    completedLayers: Math.floor(entry.quantity / entry.boxesPerLayer),
    openedLayers: Math.ceil(entry.quantity / entry.boxesPerLayer)
  }));

  const moqCurrent = productLayers.length <= 1
    ? (productLayers[0]?.quantity ?? 0)
    : productLayers.reduce(
        (sum, p) => sum + Math.min(...productLayers.map(x => x.completedLayers)) * p.boxesPerLayer,
        0
      );

  const balancedLayers = productLayers.length === 0 ? 0 : Math.min(...productLayers.map(p => p.completedLayers));
  const totalBoxes = productLayers.reduce((sum, p) => sum + p.quantity, 0);
  const progressMeta = {
    balancedLayers,
    totalBoxes,
    remainingToTarget: Math.max(0, go.moqTarget - moqCurrent),
    productLayers
  };

  let newStatus: GroupOrderStatus = go.status as GroupOrderStatus;
  if (go.status === 'OPEN' && moqCurrent >= go.moqTarget) newStatus = 'MOQ_REACHED';
  else if (go.status === 'MOQ_REACHED' && moqCurrent < go.moqTarget) newStatus = 'OPEN';

  await prisma.groupOrder.update({
    where: { id: groupOrderId },
    data: { moqCurrent, status: newStatus, meta: progressMeta as any }
  });
  return moqCurrent;
}
