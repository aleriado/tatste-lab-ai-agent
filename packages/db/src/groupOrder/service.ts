/**
 * Group Order Service - Public API
 * 
 * Combines allocation logic with repository operations to provide
 * a clean public API for group order operations.
 */

import { allocateToGroupOrder } from './allocation';
import { loadGroupOrderState, saveAllocationResult, recalcMoq, ensureParticipant } from './repository';
import type { AllocationInput, AllocationResult, ProductLogistics } from './types';

export interface AddItemToGroupOrderInput {
  code: string;
  customerId: string;
  product: ProductLogistics;
  quantityUnits: number;
  productName: string;
  /** Fallback when tier prices are not provided. */
  unitPrice: number;
  imageUrl: string | null;
  /**
   * Group/import tier pricing (both are already price per unit):
   * - When user's total boxes for this product < 2 → unit price = importPricePer2Boxes.
   * - When user's total boxes >= 2 → unit price = importPricePerSurface.
   * Total price = unitPrice * total units.
   */
  importPricePer2Boxes?: number;
  importPricePerSurface?: number;
}

export interface AddItemToGroupOrderResult {
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

/**
 * Add item to group order using strict allocation rules
 * 
 * This is the main entry point for adding products to group orders.
 * It handles:
 * - Loading current state
 * - Running allocation algorithm
 * - Saving results with transaction safety
 * - Error handling and logging
 */
export async function addItemToGroupOrder(
  input: AddItemToGroupOrderInput
): Promise<AddItemToGroupOrderResult> {
  const { code, customerId, product, quantityUnits, productName, unitPrice, imageUrl, importPricePer2Boxes, importPricePerSurface } = input;

  try {
    // Load current group order state
    const groupOrder = await loadGroupOrderState(code);

    // Prepare allocation input
    const allocationInput: AllocationInput = {
      groupOrderId: groupOrder.id,
      customerId,
      product,
      quantityUnits
    };

    // Run allocation algorithm (pure logic, no DB)
    const result = allocateToGroupOrder(allocationInput, groupOrder);

    // If allocation failed, return error
    if (!result.success) {
      console.log(`[db] Group order allocation failed: ${result.error?.code}`, {
        code,
        customerId,
        productId: product.productId,
        error: result.error
      });

      return {
        success: false,
        allocatedBoxes: result.allocatedBoxes,
        allocatedUnits: result.allocatedUnits,
        surfacesOpened: result.surfacesOpened,
        layersOpened: result.layersOpened,
        error: result.error
      };
    }

    // Tier is chosen in saveAllocationResult from user's total boxes (existing + this add). Both tier prices are per-unit.
    // Save allocation result to database
    await saveAllocationResult(
      groupOrder.id,
      result,
      customerId,
      product.productId,
      product.variantId ?? null,
      productName,
      unitPrice,
      imageUrl,
      product.manufacturer,
      product.boxesPerLayer,
      product.unitsPerBox,
      product.layersPerSurface,
      importPricePer2Boxes,
      importPricePerSurface
    );

    // Auto-join: ensure the customer is a participant (implicit join on first add)
    await ensureParticipant(groupOrder.id, customerId);

    // Update moqCurrent for backward compatibility (used by group_discover)
    console.log(`[service] Calling recalcMoq for groupOrderId=${groupOrder.id}, code=${code}`);
    const updatedMoqCurrent = await recalcMoq(groupOrder.id);
    console.log(`[service] recalcMoq completed: groupOrderId=${groupOrder.id}, updatedMoqCurrent=${updatedMoqCurrent}`);

    console.log(`[db] Group order allocation success`, {
      code,
      customerId,
      productId: product.productId,
      allocatedBoxes: result.allocatedBoxes,
      allocatedUnits: result.allocatedUnits,
      surfacesOpened: result.surfacesOpened,
      layersOpened: result.layersOpened
    });

    return {
      success: true,
      allocatedBoxes: result.allocatedBoxes,
      allocatedUnits: result.allocatedUnits,
      surfacesOpened: result.surfacesOpened,
      layersOpened: result.layersOpened
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[db] Group order service error`, { code, customerId, error: message });

    return {
      success: false,
      allocatedBoxes: 0,
      allocatedUnits: 0,
      surfacesOpened: 0,
      layersOpened: 0,
      error: {
        code: 'INVALID_STATE',
        message,
        details: { originalError: message }
      }
    };
  }
}
