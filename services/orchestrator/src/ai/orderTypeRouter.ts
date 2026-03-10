/**
 * Order Type Router
 *
 * Higher-level wrapper around the Intervention Gate Engine's evaluateOrderTypeOptions.
 * Adds type-specific option details (quantity constraints, process explanations),
 * handles Dream List redirect for CATALOG_EXTENSION products, and surfaces
 * missing logistics metadata explanations.
 */

import {
  evaluateOrderTypeOptions,
  handleDreamListProduct,
  resolveProductState,
} from './interventionGates';
import { getWooAdapter } from '../adapters/woocommerce';
import type {
  SessionContext,
  AvailableOrderTypes,
} from '@taste-labs/shared';
import { logInfo } from '../logger';

// ── Type-specific option details ──

export interface RegularOrderOptions {
  type: 'regular';
  pricePerUnit?: string;
  description: string;
}

export interface StockOrderOptions {
  type: 'stock';
  pricePerUnit?: string;
  /** Minimum units for this product (moqBoxes * unitsPerBox). */
  moq?: number;
  /** Minimum order quantity in boxes. Use for display ("3 boxes"). */
  moqBoxes?: number;
  description: string;
}

export interface GroupOrderOptions {
  type: 'group';
  pricePerUnit?: string;
  existingOrders: { code: string; progress: string; daysLeft?: number }[];
  description: string;
}

export interface ImportOrderOptions {
  type: 'import';
  pricePerUnit?: string;
  existingOrders: { code: string; progress: string; daysLeft?: number }[];
  description: string;
}

export interface DreamListRedirect {
  isDreamList: true;
  productId: string;
  productName: string;
  dreamStage?: string;
  message: string;
  alternatives: { id: string; name: string; manufacturer: string }[];
}

export interface OrderTypeRouterResult {
  available: AvailableOrderTypes;
  dreamListRedirect?: DreamListRedirect;
  missingLogisticsExplanation?: string;
  /** When import is not in options (e.g. product missing logistics). Tell the user this reason when they ask for import. */
  importNotAvailableReason?: string;
  /** When import IS available for an individual: show this advisory but still allow them to choose import. */
  importAdvisoryForIndividuals?: string;
}

// ── Main entry point ──

/**
 * Determines available order types for a product and user combination.
 *
 * Delegates core logic to evaluateOrderTypeOptions (intervention gates),
 * then enriches the result with:
 * - Type-specific descriptions and constraints
 * - Dream List redirect for CATALOG_EXTENSION products
 * - Missing logistics metadata explanation when Group/Import are excluded
 */
export async function getAvailableOrderTypes(
  productId: string,
  customerId: string,
  sessionContext: SessionContext,
): Promise<OrderTypeRouterResult> {
  logInfo(`[OrderTypeRouter] getAvailableOrderTypes productId=${productId} customerId=${customerId}`, {});

  // Delegate to the intervention gate engine for core evaluation
  const available = await evaluateOrderTypeOptions(productId, customerId, sessionContext);

  const result: OrderTypeRouterResult = { available };

  // Handle CATALOG_EXTENSION — Dream List redirect
  if (available.productState === 'CATALOG_EXTENSION') {
    const woo = getWooAdapter();
    const rawProduct = await woo.getProduct(productId);

    if (rawProduct) {
      const product = resolveProductState(rawProduct);
      // Fetch catalog products for alternatives
      const catalogProducts = rawProduct.manufacturer
        ? await woo.searchProducts(rawProduct.manufacturer, { limit: 10 })
        : [];

      const productCards = catalogProducts.map((p) => ({
        id: p.id,
        name: p.name,
        price: p.price,
        manufacturer: p.manufacturer,
        productState: (p.metadata?.productState as string) === 'CATALOG_EXTENSION'
          ? 'CATALOG_EXTENSION' as const
          : 'ACTIVE_IMPORTED' as const,
      }));

      const dreamListResult = handleDreamListProduct(product, productCards);

      result.dreamListRedirect = {
        isDreamList: true,
        productId: product.id,
        productName: product.name,
        dreamStage: product.dreamStage,
        message: dreamListResult.stageExplanation,
        alternatives: dreamListResult.alternatives.map((alt) => ({
          id: alt.id,
          name: alt.name,
          manufacturer: alt.manufacturer ?? '',
        })),
      };
    }

    return result;
  }

  // Check for missing logistics metadata — explain why Group/Import are excluded
  const hasGroup = available.types.some((t) => t.type === 'group');
  const hasImport = available.types.some((t) => t.type === 'import');

  if (!hasGroup && !hasImport) {
    // Only add explanation if the product is ACTIVE_IMPORTED (not already Dream List)
    // and has some order types available (meaning it's a real product, just missing logistics)
    if (available.types.length > 0) {
      result.missingLogisticsExplanation =
        `Group and Import order types are not available for "${available.productName}" because it lacks logistics metadata (units per box, boxes per layer, layers per surface). ` +
        'This product is available for Regular or Stock orders.';
    }
  }

  // When group is available but import is not (e.g. product missing logistics), no longer due to user type — import is now available for all.
  // importNotAvailableReason is only set when product has no logistics (handled above with missingLogisticsExplanation).

  // When import IS available and user is an individual, add advisory so the AI can mention it (but still allow import).
  if (hasImport && sessionContext.userType === 'private_consumer') {
    result.importAdvisoryForIndividuals =
      'Import orders are best suited for supermarkets and business accounts (full palette). You can still create one; group order lets you share a palette with others if you prefer.';
  }

  return result;
}

// ── Type-specific option extractors ──

/**
 * Extracts Regular order options from the available types.
 */
export function getRegularOrderOptions(available: AvailableOrderTypes): RegularOrderOptions | null {
  const option = available.types.find((t) => t.type === 'regular');
  if (!option) return null;

  return {
    type: 'regular',
    pricePerUnit: option.pricePerUnit,
    description:
      'Standard retail purchase. No minimum quantity required. ' +
      'Order any amount and receive at retail pricing.',
  };
}

/**
 * Extracts Stock order options from the available types.
 */
export function getStockOrderOptions(available: AvailableOrderTypes): StockOrderOptions | null {
  const option = available.types.find((t) => t.type === 'stock');
  if (!option) return null;

  return {
    type: 'stock',
    pricePerUnit: option.pricePerUnit,
    moq: option.moq,
    moqBoxes: option.moqBoxes,
    description:
      'Wholesale pricing with a minimum order quantity (in boxes). ' +
      'Order in bulk to receive discounted wholesale rates.',
  };
}

/**
 * Extracts Group order options from the available types.
 */
export function getGroupOrderOptions(available: AvailableOrderTypes): GroupOrderOptions | null {
  const option = available.types.find((t) => t.type === 'group');
  if (!option) return null;

  return {
    type: 'group',
    pricePerUnit: option.pricePerUnit,
    existingOrders: option.existingOrders ?? [],
    description:
      'Share a palette with other buyers to reach import pricing. ' +
      'Multiple participants fill surfaces and layers together. ' +
      'The order ships when the palette is complete or the deadline is reached.',
  };
}

/**
 * Extracts Import order options from the available types.
 */
export function getImportOrderOptions(available: AvailableOrderTypes): ImportOrderOptions | null {
  const option = available.types.find((t) => t.type === 'import');
  if (!option) return null;

  return {
    type: 'import',
    pricePerUnit: option.pricePerUnit,
    existingOrders: option.existingOrders ?? [],
    description:
      'Single-user palette import for restaurants and supermarkets. ' +
      'You fill the entire palette yourself at import pricing. ' +
      'Same palette rules as group orders, but only you participate.',
  };
}
