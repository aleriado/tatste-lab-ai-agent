/**
 * Group Order Allocation Algorithm - Pure Logic (Deterministic)
 * 
 * This module implements the strict client rules for group order allocation.
 * It is pure logic with no DB dependencies for easy testing.
 */

import type {
  AllocationInput,
  AllocationResult,
  AllocationError,
  GroupOrderState,
  SurfaceState,
  LayerState,
  ProductLogistics
} from './types';
import { validateProductLogistics } from './validation';

/**
 * Main allocation function - implements all client rules
 */
export function allocateToGroupOrder(
  input: AllocationInput,
  currentState: GroupOrderState
): AllocationResult {
  // Validate product logistics
  const validationError = validateProductLogistics(input.product);
  if (validationError) {
    return {
      success: false,
      allocatedBoxes: 0,
      allocatedUnits: 0,
      surfacesOpened: 0,
      layersOpened: 0,
      surfacesUsed: [],
      layersUsed: [],
      error: validationError
    };
  }

  // CLIENT RULE 1: Validate manufacturer match
  const manufacturerError = validateManufacturer(input.product.manufacturer, currentState);
  if (manufacturerError) {
    return {
      success: false,
      allocatedBoxes: 0,
      allocatedUnits: 0,
      surfacesOpened: 0,
      layersOpened: 0,
      surfacesUsed: [],
      layersUsed: [],
      error: manufacturerError
    };
  }

  // Validate quantity
  if (input.quantityUnits <= 0) {
    return {
      success: false,
      allocatedBoxes: 0,
      allocatedUnits: 0,
      surfacesOpened: 0,
      layersOpened: 0,
      surfacesUsed: [],
      layersUsed: [],
      error: {
        code: 'INVALID_QUANTITY',
        message: 'Quantity must be greater than 0',
        details: { quantityUnits: input.quantityUnits }
      }
    };
  }

  // CLIENT RULE 4: Calculate surface_max_layers (min across all products)
  const newSurfaceMaxLayers = calculateSurfaceMaxLayers(input.product, currentState);
  
  // Check if adding this product would reduce surface_max_layers below already opened layers
  const layerConflictError = checkLayerLimitConflict(newSurfaceMaxLayers, currentState);
  if (layerConflictError) {
    return {
      success: false,
      allocatedBoxes: 0,
      allocatedUnits: 0,
      surfacesOpened: 0,
      layersOpened: 0,
      surfacesUsed: [],
      layersUsed: [],
      error: layerConflictError
    };
  }

  // Convert units to boxes (wholesale ordering - must order full boxes)
  // ASSUMPTION: Wholesale requires full cartons, so we ceil to next box
  const quantityBoxes = Math.ceil(input.quantityUnits / input.product.unitsPerBox);
  const actualUnits = quantityBoxes * input.product.unitsPerBox;

  // Perform allocation
  const allocation = performAllocation(
    input.product,
    quantityBoxes,
    actualUnits,
    currentState,
    newSurfaceMaxLayers
  );

  return allocation;
}

/**
 * CLIENT RULE 1: Validate manufacturer match
 */
function validateManufacturer(
  productManufacturer: string,
  state: GroupOrderState
): AllocationError | null {
  if (state.manufacturerId && state.manufacturerId !== productManufacturer) {
    return {
      code: 'MANUFACTURER_MISMATCH',
      message: `Group order is locked to manufacturer "${state.manufacturerId}"`,
      details: {
        groupOrderManufacturer: state.manufacturerId,
        productManufacturer
      }
    };
  }
  return null;
}

/**
 * CLIENT RULE 4: Calculate surface_max_layers = MIN(layers_per_surface) across all products
 */
function calculateSurfaceMaxLayers(
  newProduct: ProductLogistics,
  state: GroupOrderState
): number {
  if (state.surfaceMaxLayers === null) {
    // First product sets the initial limit
    return newProduct.layersPerSurface;
  }

  // Return minimum of current limit and new product's layers_per_surface
  return Math.min(state.surfaceMaxLayers, newProduct.layersPerSurface);
}

/**
 * Check if new surface_max_layers would conflict with already opened layers
 */
function checkLayerLimitConflict(
  newSurfaceMaxLayers: number,
  state: GroupOrderState
): AllocationError | null {
  for (const surface of state.surfaces) {
    const openedLayers = surface.layers.length;
    if (openedLayers > newSurfaceMaxLayers) {
      return {
        code: 'LAYER_LIMIT_CONFLICT',
        message: `Cannot add product because it reduces allowed layers per surface (${newSurfaceMaxLayers}) below currently opened layers (${openedLayers})`,
        details: {
          newSurfaceMaxLayers,
          surfaceIndex: surface.surfaceIndex,
          openedLayers,
          currentSurfaceMaxLayers: state.surfaceMaxLayers
        }
      };
    }
  }
  return null;
}

/**
 * Perform the actual allocation across surfaces and layers
 */
function performAllocation(
  product: ProductLogistics,
  quantityBoxes: number,
  quantityUnits: number,
  state: GroupOrderState,
  surfaceMaxLayers: number
): AllocationResult {
  let remainingBoxes = quantityBoxes;
  let remainingUnits = quantityUnits;
  const surfacesUsed = new Set<number>();
  const layersUsed: Array<{ surfaceIndex: number; layerIndex: number; boxes: number; units: number }> = [];
  let newSurfacesOpened = 0;
  let newLayersOpened = 0;

  // CLIENT RULE 5: Fill existing open layers for the SAME product first
  for (const surface of state.surfaces) {
    if (remainingBoxes === 0) break;

    for (const layer of surface.layers) {
      if (remainingBoxes === 0) break;

      // Only fill layers with the same product
      if (layer.productId !== product.productId || layer.variantId !== (product.variantId ?? null)) {
        continue;
      }

      // Only fill open layers (not full)
      if (layer.status !== 'open') {
        continue;
      }

      const availableBoxes = layer.capacityBoxes - layer.filledBoxes;
      if (availableBoxes <= 0) {
        continue;
      }

      const boxesToAdd = Math.min(remainingBoxes, availableBoxes);
      const unitsToAdd = boxesToAdd * product.unitsPerBox;

      remainingBoxes -= boxesToAdd;
      remainingUnits -= unitsToAdd;
      surfacesUsed.add(surface.surfaceIndex);
      layersUsed.push({
        surfaceIndex: surface.surfaceIndex,
        layerIndex: layer.layerIndex,
        boxes: boxesToAdd,
        units: unitsToAdd
      });
    }
  }

  // If still have remaining quantity, need to open new layers
  while (remainingBoxes > 0) {
    // Find a surface with available layer slots
    let targetSurface: SurfaceState | null = null;

    for (const surface of state.surfaces) {
      if (surface.layers.length < surfaceMaxLayers && surface.status === 'open') {
        targetSurface = surface;
        break;
      }
    }

    // If no surface has available slots, need to open a new surface
    if (!targetSurface) {
      const nextSurfaceIndex = state.surfaces.length;

      // Check if we can open a new surface
      if (!state.allowExtraSurfaces && nextSurfaceIndex >= state.moqSurfaces) {
        // Cannot open more surfaces - overflow error
        return {
          success: false,
          allocatedBoxes: quantityBoxes - remainingBoxes,
          allocatedUnits: quantityUnits - remainingUnits,
          surfacesOpened: newSurfacesOpened,
          layersOpened: newLayersOpened,
          surfacesUsed: Array.from(surfacesUsed),
          layersUsed,
          error: {
            code: 'OVERFLOW',
            message: `Cannot allocate ${remainingBoxes} more boxes - would exceed MOQ surfaces limit (${state.moqSurfaces})`,
            details: {
              moqSurfaces: state.moqSurfaces,
              surfaceMaxLayers,
              currentSurfaces: state.surfaces.length,
              requestedBoxes: quantityBoxes,
              allocatedBoxes: quantityBoxes - remainingBoxes,
              remainingBoxes,
              allowExtraSurfaces: state.allowExtraSurfaces
            }
          }
        };
      }

      if (nextSurfaceIndex >= state.maxSurfacesLimit) {
        return {
          success: false,
          allocatedBoxes: quantityBoxes - remainingBoxes,
          allocatedUnits: quantityUnits - remainingUnits,
          surfacesOpened: newSurfacesOpened,
          layersOpened: newLayersOpened,
          surfacesUsed: Array.from(surfacesUsed),
          layersUsed,
          error: {
            code: 'OVERFLOW',
            message: `Cannot allocate ${remainingBoxes} more boxes - would exceed maximum surfaces limit (${state.maxSurfacesLimit})`,
            details: {
              maxSurfacesLimit: state.maxSurfacesLimit,
              currentSurfaces: state.surfaces.length,
              requestedBoxes: quantityBoxes,
              allocatedBoxes: quantityBoxes - remainingBoxes,
              remainingBoxes
            }
          }
        };
      }

      // Create a virtual new surface for allocation calculation
      targetSurface = {
        id: `virtual_surface_${nextSurfaceIndex}`,
        surfaceIndex: nextSurfaceIndex,
        maxLayers: surfaceMaxLayers,
        status: 'open',
        layers: []
      };
      state.surfaces.push(targetSurface);
      newSurfacesOpened++;
    }

    // Open a new layer on the target surface
    const nextLayerIndex = targetSurface.layers.length;
    const boxesToAdd = Math.min(remainingBoxes, product.boxesPerLayer);
    const unitsToAdd = boxesToAdd * product.unitsPerBox;

    const newLayer: LayerState = {
      id: `virtual_layer_${targetSurface.surfaceIndex}_${nextLayerIndex}`,
      layerIndex: nextLayerIndex,
      productId: product.productId,
      variantId: product.variantId ?? null,
      capacityBoxes: product.boxesPerLayer,
      capacityUnits: product.boxesPerLayer * product.unitsPerBox,
      filledBoxes: boxesToAdd,
      filledUnits: unitsToAdd,
      status: boxesToAdd >= product.boxesPerLayer ? 'full' : 'open'
    };

    targetSurface.layers.push(newLayer);
    remainingBoxes -= boxesToAdd;
    remainingUnits -= unitsToAdd;
    surfacesUsed.add(targetSurface.surfaceIndex);
    layersUsed.push({
      surfaceIndex: targetSurface.surfaceIndex,
      layerIndex: nextLayerIndex,
      boxes: boxesToAdd,
      units: unitsToAdd
    });
    newLayersOpened++;
  }

  return {
    success: true,
    allocatedBoxes: quantityBoxes,
    allocatedUnits: quantityUnits,
    surfacesOpened: newSurfacesOpened,
    layersOpened: newLayersOpened,
    surfacesUsed: Array.from(surfacesUsed),
    layersUsed
  };
}
