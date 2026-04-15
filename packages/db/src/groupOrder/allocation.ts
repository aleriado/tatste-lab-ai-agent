/**
 * Group Order Allocation Algorithm - Pure Logic (Deterministic)
 *
 * UNIT MODEL:
 * - All tracking is in UNITS (the atomic unit).
 * - filledBoxes is always derived: floor(filledUnits / unitsPerBox)
 * - A layer is full when filledUnits >= capacityUnits
 * - capacityUnits = boxesPerLayer * unitsPerBox
 * - Partial layers are allowed — multiple participants fill a layer together.
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

export function allocateToGroupOrder(
  input: AllocationInput,
  currentState: GroupOrderState
): AllocationResult {
  const validationError = validateProductLogistics(input.product);
  if (validationError) return fail(validationError);

  const manufacturerError = validateManufacturer(input.product.manufacturer, currentState);
  if (manufacturerError) return fail(manufacturerError);

  if (input.quantityUnits <= 0) {
    return fail({
      code: 'INVALID_QUANTITY',
      message: 'Quantity must be greater than 0',
      details: { quantityUnits: input.quantityUnits }
    });
  }

  // Group order MOQ in boxes: each user must commit at least moqBoxes boxes (spec)
  if (!currentState.isImport && input.product.moqBoxes != null && input.product.moqBoxes > 0) {
    const requestedBoxes = Math.floor(input.quantityUnits / input.product.unitsPerBox);
    if (requestedBoxes < input.product.moqBoxes) {
      return fail({
        code: 'BELOW_MOQ',
        message: `Minimum order for this product is ${input.product.moqBoxes} boxes. You requested ${requestedBoxes} boxes.`,
        details: { moqBoxes: input.product.moqBoxes, requestedBoxes, requestedUnits: input.quantityUnits }
      });
    }
  }

  const newSurfaceMaxLayers = calculateSurfaceMaxLayers(input.product, currentState);
  const layerConflictError = checkLayerLimitConflict(newSurfaceMaxLayers, currentState);
  if (layerConflictError) return fail(layerConflictError);

  return performAllocation(input.product, input.quantityUnits, currentState, newSurfaceMaxLayers, input.customerId);
}

function fail(error: AllocationError): AllocationResult {
  return {
    success: false,
    allocatedBoxes: 0,
    allocatedUnits: 0,
    surfacesOpened: 0,
    layersOpened: 0,
    surfacesUsed: [],
    layersUsed: [],
    error
  };
}

// ── Manufacturer validation ──────────────────────────────────────────────────

function normalizeManufacturer(name: string): string {
  return name
    .replace(/['\u2019\u0060\u00B4]/g, '')
    .replace(/\./g, ' ')
    .replace(/[,"\-_]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const dp: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = i;
    for (let j = 1; j <= b.length; j++) {
      const val = a[i - 1] === b[j - 1] ? dp[j - 1] : Math.min(dp[j - 1], dp[j], prev) + 1;
      dp[j - 1] = prev;
      prev = val;
    }
    dp[b.length] = prev;
  }
  return dp[b.length];
}

function validateManufacturer(productManufacturer: string, state: GroupOrderState): AllocationError | null {
  if (!state.manufacturerId) return null;
  const a = normalizeManufacturer(state.manufacturerId);
  const b = normalizeManufacturer(productManufacturer);
  if (a === b) return null;
  const maxDist = a.length > 20 ? 3 : 2;
  if (editDistance(a, b) <= maxDist) return null;
  return {
    code: 'MANUFACTURER_MISMATCH',
    message: `Group order is locked to manufacturer "${state.manufacturerId}"`,
    details: { groupOrderManufacturer: state.manufacturerId, productManufacturer }
  };
}

// ── Layer limit rules ────────────────────────────────────────────────────────

function calculateSurfaceMaxLayers(product: ProductLogistics, state: GroupOrderState): number {
  return state.surfaceMaxLayers === null
    ? product.layersPerSurface
    : Math.min(state.surfaceMaxLayers, product.layersPerSurface);
}

function checkLayerLimitConflict(newMax: number, state: GroupOrderState): AllocationError | null {
  for (const surface of state.surfaces) {
    if (surface.layers.length > newMax) {
      return {
        code: 'LAYER_LIMIT_CONFLICT',
        message: `Cannot add product — it reduces allowed layers per surface (${newMax}) below currently opened layers (${surface.layers.length})`,
        details: { newSurfaceMaxLayers: newMax, surfaceIndex: surface.surfaceIndex, openedLayers: surface.layers.length }
      };
    }
  }
  return null;
}

// ── Core allocation ──────────────────────────────────────────────────────────

function performAllocation(
  product: ProductLogistics,
  requestedUnits: number,
  state: GroupOrderState,
  surfaceMaxLayers: number,
  customerId: string
): AllocationResult {
  const capacityUnitsPerLayer = product.boxesPerLayer * product.unitsPerBox;
  let remainingUnits = requestedUnits;

  const surfacesUsed = new Set<number>();
  const layersUsed: Array<{ surfaceIndex: number; layerIndex: number; boxes: number; units: number }> = [];
  let newSurfacesOpened = 0;
  let newLayersOpened = 0;

  const moqBoxes = state.isImport ? 0 : (product.moqBoxes ?? 0);
  const maxUsersPerLayer = moqBoxes > 0 ? (product.boxesPerLayer / moqBoxes) | 0 : Infinity;

  // RULE: Fill existing open layers for the SAME product first
  for (const surface of state.surfaces) {
    if (remainingUnits <= 0) break;
    for (const layer of surface.layers) {
      if (remainingUnits <= 0) break;
      if (layer.productId !== product.productId || layer.variantId !== (product.variantId ?? null)) continue;
      if (layer.status !== 'open') continue;

      // Layer sharing cap: max users per layer = floor(boxes per layer / MOQ) (spec)
      if (maxUsersPerLayer < Infinity) {
        const alreadyInLayer = (layer.participantCustomerIds && layer.participantCustomerIds.includes(customerId)) ?? false;
        const newParticipantCount = alreadyInLayer ? layer.participantCount : layer.participantCount + 1;
        if (newParticipantCount > maxUsersPerLayer) continue; // skip; try next layer or open new
      }

      const availableUnits = layer.capacityUnits - layer.filledUnits;
      if (availableUnits <= 0) continue;

      const unitsToAdd = Math.min(remainingUnits, availableUnits);
      remainingUnits -= unitsToAdd;
      surfacesUsed.add(surface.surfaceIndex);
      layersUsed.push({
        surfaceIndex: surface.surfaceIndex,
        layerIndex: layer.layerIndex,
        boxes: Math.floor(unitsToAdd / product.unitsPerBox),
        units: unitsToAdd
      });
    }
  }

  // Open new layers as needed
  while (remainingUnits > 0) {
    let targetSurface: SurfaceState | null = null;
    for (const surface of state.surfaces) {
      if (surface.layers.length < surfaceMaxLayers && surface.status === 'open') {
        targetSurface = surface;
        break;
      }
    }

    if (!targetSurface) {
      const nextIdx = state.surfaces.length;
      if (!state.allowExtraSurfaces && nextIdx >= state.moqSurfaces) {
        return {
          success: false,
          allocatedBoxes: Math.floor((requestedUnits - remainingUnits) / product.unitsPerBox),
          allocatedUnits: requestedUnits - remainingUnits,
          surfacesOpened: newSurfacesOpened,
          layersOpened: newLayersOpened,
          surfacesUsed: Array.from(surfacesUsed),
          layersUsed,
          error: {
            code: 'OVERFLOW',
            message: `Cannot allocate ${remainingUnits} more units — would exceed MOQ surfaces limit (${state.moqSurfaces})`,
            details: { moqSurfaces: state.moqSurfaces, surfaceMaxLayers, currentSurfaces: state.surfaces.length, allowExtraSurfaces: state.allowExtraSurfaces }
          }
        };
      }
      if (nextIdx >= state.maxSurfacesLimit) {
        return {
          success: false,
          allocatedBoxes: Math.floor((requestedUnits - remainingUnits) / product.unitsPerBox),
          allocatedUnits: requestedUnits - remainingUnits,
          surfacesOpened: newSurfacesOpened,
          layersOpened: newLayersOpened,
          surfacesUsed: Array.from(surfacesUsed),
          layersUsed,
          error: {
            code: 'OVERFLOW',
            message: `Cannot allocate — would exceed maximum surfaces limit (${state.maxSurfacesLimit})`,
            details: { maxSurfacesLimit: state.maxSurfacesLimit, currentSurfaces: state.surfaces.length }
          }
        };
      }
      targetSurface = {
        id: `virtual_surface_${nextIdx}`,
        surfaceIndex: nextIdx,
        maxLayers: surfaceMaxLayers,
        status: 'open',
        layers: []
      };
      state.surfaces.push(targetSurface);
      newSurfacesOpened++;
    }

    const nextLayerIndex = targetSurface.layers.length;
    const unitsToAdd = Math.min(remainingUnits, capacityUnitsPerLayer);
    const boxesInLayer = Math.floor(unitsToAdd / product.unitsPerBox);

    const newLayer: LayerState = {
      id: `virtual_layer_${targetSurface.surfaceIndex}_${nextLayerIndex}`,
      layerIndex: nextLayerIndex,
      productId: product.productId,
      variantId: product.variantId ?? null,
      capacityBoxes: product.boxesPerLayer,
      capacityUnits: capacityUnitsPerLayer,
      filledBoxes: boxesInLayer,
      filledUnits: unitsToAdd,
      status: unitsToAdd >= capacityUnitsPerLayer ? 'full' : 'open',
      participantCount: 1,
      participantCustomerIds: [customerId],
    };

    targetSurface.layers.push(newLayer);
    remainingUnits -= unitsToAdd;
    surfacesUsed.add(targetSurface.surfaceIndex);
    layersUsed.push({
      surfaceIndex: targetSurface.surfaceIndex,
      layerIndex: nextLayerIndex,
      boxes: boxesInLayer,
      units: unitsToAdd
    });
    newLayersOpened++;
  }

  const allocatedUnits = requestedUnits - remainingUnits;
  return {
    success: true,
    allocatedBoxes: Math.floor(allocatedUnits / product.unitsPerBox),
    allocatedUnits,
    surfacesOpened: newSurfacesOpened,
    layersOpened: newLayersOpened,
    surfacesUsed: Array.from(surfacesUsed),
    layersUsed
  };
}
