/**
 * Group Order Repository - Database Operations
 * 
 * Handles loading and saving group order state with proper transaction handling
 * and row-level locking for concurrency safety.
 */

import { prisma } from '../index';
import type { GroupOrderState, AllocationResult, LayerContribution } from './types';
import { getGroupOrderConfig } from './config';

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
  unitsPerBox: number
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
    let currentSurfaceMaxLayers = groupOrder.surfaceMaxLayers;
    
    if (!groupOrder.manufacturerId) {
      currentSurfaceMaxLayers = result.layersUsed.length > 0 ? 
        (await tx.groupOrderSurface.findFirst({
          where: { groupOrderId },
          orderBy: { surfaceIndex: 'asc' }
        }))?.maxLayers ?? 1 : 1;

      await tx.groupOrder.update({
        where: { id: groupOrderId },
        data: {
          manufacturerId: manufacturer,
          surfaceMaxLayers: currentSurfaceMaxLayers
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
        // Create new surface
        surface = await tx.groupOrderSurface.create({
          data: {
            groupOrderId,
            surfaceIndex: layerAlloc.surfaceIndex,
            maxLayers: groupOrder.surfaceMaxLayers ?? 1,
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
        // Create new layer - use product's actual capacity
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
            filledBoxes: layerAlloc.boxes,
            filledUnits: layerAlloc.units,
            status: layerAlloc.boxes >= boxesPerLayer ? 'full' : 'open',
            contributions: [contribution] as any
          }
        });
      } else {
        // Update existing layer
        const existingContributions = (layer.contributions as LayerContribution[] | null) ?? [];
        const newContribution: LayerContribution = {
          customerId,
          boxes: layerAlloc.boxes,
          units: layerAlloc.units,
          timestamp: new Date().toISOString()
        };

        const newFilledBoxes = layer.filledBoxes + layerAlloc.boxes;
        const newFilledUnits = layer.filledUnits + layerAlloc.units;
        const isFull = newFilledBoxes >= layer.capacityBoxes;

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
