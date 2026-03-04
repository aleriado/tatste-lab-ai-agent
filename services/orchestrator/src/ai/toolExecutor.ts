import { getWooAdapter } from '../adapters/woocommerce';
import type { WooProduct } from '../adapters/woocommerce';
import {
  addCartItem,
  removeCartItem,
  updateCartItemQty,
  getOrCreateCart,
  clearCart,
  computeCartSummary,
  createGroupOrder,
  joinGroupOrder,
  leaveGroupOrder,
  addGroupOrderItem,
  removeGroupOrderItem,
  getGroupOrderStatus,
  listDiscoverableGroupOrders,
  findBestGroupOrdersForManufacturer,
  deleteGroupOrderByCreator,
  addItemToGroupOrder
} from '@taste-labs/db';
import type { ProductLogistics } from '@taste-labs/db/src/groupOrder/types';
import { getPaymentAdapter } from '../adapters/payment';
import { logInfo, logError } from '../logger';

export interface ToolContext {
  customerId: string;
  traceId: string;
}

export interface ToolResult {
  data: unknown;
  // Products returned by search/detail for the frontend to render as cards
  products?: WooProduct[];
}

/**
 * Extract product logistics for group order allocation
 * 
 * Validates that all required fields are present for the strict allocation algorithm.
 */
function extractProductLogistics(product: WooProduct): ProductLogistics | null {
  const manufacturer = product.manufacturer ?? product.metadata?.manufacturer as string | undefined;
  const unitsPerBox = product.unitsPerBox ?? product.metadata?.unitsPerBox as number | undefined;
  const boxesPerLayer = product.boxesPerLayer ?? product.metadata?.boxesPerLayer as number | undefined;
  const layersPerSurface = product.layersPerSurface ?? product.metadata?.layersPerSurface as number | undefined;
  const boxesPerSurface = product.boxesPerSurface ?? product.metadata?.boxesPerSurface as number | undefined;

  // Validate all required fields
  if (!manufacturer || typeof manufacturer !== 'string' || manufacturer.trim() === '') {
    return null;
  }

  if (!unitsPerBox || typeof unitsPerBox !== 'number' || unitsPerBox <= 0) {
    return null;
  }

  if (!boxesPerLayer || typeof boxesPerLayer !== 'number' || boxesPerLayer <= 0) {
    return null;
  }

  if (!layersPerSurface || typeof layersPerSurface !== 'number' || layersPerSurface <= 0) {
    return null;
  }

  return {
    productId: product.id,
    variantId: null,
    name: product.name,
    manufacturer: manufacturer.trim(),
    unitsPerBox,
    boxesPerLayer,
    layersPerSurface,
    boxesPerSurface: boxesPerSurface ?? (boxesPerLayer * layersPerSurface)
  };
}

/**
 * Legacy metadata extractor for backward compatibility
 */
function productGroupOrderMetadata(product: WooProduct) {
  return {
    manufacturer: product.manufacturer ?? product.metadata?.manufacturer,
    boxesPerLayer: product.boxesPerLayer ?? (product.metadata?.boxesPerLayer as number | undefined)
  };
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResult> {
  const woo = getWooAdapter();

  logInfo(`Tool call: ${name}`, { traceId: ctx.traceId, args });

  switch (name) {
    // ── Product tools ──
    case 'product_search': {
      const query = (args.query as string) ?? '';
      const requestedLimit = Number(args.limit);
      let normalizedLimit =
        Number.isFinite(requestedLimit) && requestedLimit > 0
          ? Math.floor(requestedLimit)
          : 200;
      // For browse/recommendations (empty or short query), enforce minimum to avoid AI passing tiny limits (e.g. 5)
      const isBrowse = !query.trim();
      if (isBrowse && normalizedLimit < 50) normalizedLimit = 100;
      const products = await woo.searchProducts(query, { limit: normalizedLimit });
      return { data: products, products };
    }

    case 'product_detail': {
      const product = await woo.getProduct(args.productId as string);
      if (!product) return { data: { error: 'Product not found' } };
      return { data: product, products: [product] };
    }

    case 'product_variations': {
      const variations = await woo.getProductVariations(args.productId as string);
      return { data: variations };
    }

    case 'suggest_complements': {
      const related = await woo.getRelatedProducts(args.productId as string);
      return { data: related, products: related };
    }

    // ── Cart tools ──
    case 'cart_add_item': {
      const productId = args.productId as string;
      const variantId = (args.variantId as string) ?? null;

      // Force quantity to 1 — the AI sometimes hallucinates quantity > 1.
      // If the user truly wants more, they can click again or say "add 3".
      // The DB layer increments existing items, so repeated adds still stack.
      const quantity = 1;

      logInfo(`cart_add_item: productId=${productId}, quantity=${quantity}, ai_requested_qty=${args.quantity}`, { traceId: ctx.traceId });

      // Fetch product info from Woo to get name/price/image
      const product = await woo.getProduct(productId);
      if (!product) return { data: { error: `Product ${productId} not found in catalog` } };

      // Validate purchasable & price before adding
      if (product.purchasable === false) {
        return { data: { error: `Sorry, "${product.name}" is currently not available for purchase.` } };
      }
      const unitPrice = parseFloat(product.price ?? '');
      if (!product.price || product.price.trim() === '' || isNaN(unitPrice) || unitPrice <= 0) {
        return { data: { error: `Sorry, "${product.name}" doesn't have a price set yet and can't be added to cart.` } };
      }
      if (product.inStock === false) {
        return { data: { error: `Sorry, "${product.name}" is currently out of stock.` } };
      }

      const cart = await addCartItem(ctx.customerId, {
        productId,
        variantId,
        name: product.name,
        imageUrl: product.images?.[0]?.src ?? null,
        unitPrice,
        quantity
      });

      const summary = computeCartSummary(cart);
      return { data: { message: `Added ${quantity}x ${product.name} to cart`, cart: summary } };
    }

    case 'cart_remove_item': {
      const cart = await removeCartItem(
        ctx.customerId,
        args.productId as string,
        (args.variantId as string) ?? null
      );
      const summary = computeCartSummary(cart);
      return { data: { message: 'Item removed from cart', cart: summary } };
    }

    case 'cart_update_quantity': {
      const cart = await updateCartItemQty(
        ctx.customerId,
        args.productId as string,
        args.quantity as number,
        (args.variantId as string) ?? null
      );
      const summary = computeCartSummary(cart);
      return { data: { message: 'Cart updated', cart: summary } };
    }

    case 'cart_view': {
      const cart = await getOrCreateCart(ctx.customerId);
      const summary = computeCartSummary(cart);
      return { data: summary };
    }

    case 'cart_clear': {
      const cart = await clearCart(ctx.customerId);
      const summary = computeCartSummary(cart);
      return { data: { message: 'Cart cleared', cart: summary } };
    }

    // ── Checkout ──
    case 'checkout_begin': {
      const cart = await getOrCreateCart(ctx.customerId);
      const summary = computeCartSummary(cart);
      if (summary.items.length === 0) {
        return { data: { error: 'Cart is empty. Add items before checkout.' } };
      }

      const payment = getPaymentAdapter();
      const result = await payment.createCheckoutSession({
        customerId: ctx.customerId,
        cartTotal: parseFloat(summary.total),
        currency: summary.currency,
        splitPayment: true,
        meta: { items: summary.items }
      });

      return {
        data: {
          message: 'Checkout session created',
          paymentUrl: result.paymentUrl,
          totalAmount: result.totalAmount,
          amountDueNow: result.amountDueNow,
          amountDueLater: result.amountDueLater,
          currency: result.currency
        }
      };
    }

    // ── Group order tools ──
    case 'group_create': {
      const go = await createGroupOrder(
        ctx.customerId,
        args.deadlineHours as number | undefined
      );
      return { data: go };
    }

    case 'group_join': {
      const go = await joinGroupOrder(args.code as string, ctx.customerId);
      return { data: go };
    }

    case 'group_leave': {
      const go = await leaveGroupOrder(args.code as string, ctx.customerId);
      return { data: go };
    }

    case 'group_delete': {
      const result = await deleteGroupOrderByCreator(args.code as string, ctx.customerId);
      return { data: result };
    }

    case 'group_status': {
      const go = await getGroupOrderStatus(args.code as string);
      return { data: go };
    }

    case 'group_discover': {
      const orders = await listDiscoverableGroupOrders({
        manufacturerId: (args.manufacturer as string | undefined) ?? undefined,
        limit: (args.limit as number | undefined) ?? 10
      });
      return { data: { orders } };
    }

    case 'group_best_match': {
      const productId = args.productId as string;
      const product = await woo.getProduct(productId);
      if (!product) return { data: { error: `Product ${productId} not found` } };

      const groupMeta = productGroupOrderMetadata(product);
      if (!groupMeta.manufacturer) {
        return {
          data: {
            error: `Product "${product.name}" is missing manufacturer mapping, so I can't find compatible group orders.`
          }
        };
      }

      const matches = await findBestGroupOrdersForManufacturer({
        manufacturerId: String(groupMeta.manufacturer),
        limit: (args.limit as number | undefined) ?? 3
      });

      return {
        data: {
          productId: product.id,
          productName: product.name,
          manufacturer: String(groupMeta.manufacturer),
          orders: matches
        }
      };
    }

    case 'group_add_item': {
      const productId = args.productId as string;
      const code = args.code as string;
      const quantity = (args.quantity as number) ?? 1;
      
      const product = await woo.getProduct(productId);
      if (!product) {
        logInfo(`group_add_item: product not found productId=${productId}`, { traceId: ctx.traceId });
        return { data: { error: `Product ${productId} not found` } };
      }

      // Validate purchasable & price
      if (product.purchasable === false) {
        logInfo(`group_add_item: product not purchasable productId=${productId}`, { traceId: ctx.traceId });
        return { data: { error: `Sorry, "${product.name}" is currently not available for purchase.` } };
      }
      const groupUnitPrice = parseFloat(product.price ?? '');
      if (!product.price || product.price.trim() === '' || isNaN(groupUnitPrice) || groupUnitPrice <= 0) {
        logInfo(`group_add_item: product missing/invalid price productId=${productId}`, { traceId: ctx.traceId });
        return { data: { error: `Sorry, "${product.name}" doesn't have a price set yet and can't be added.` } };
      }
      if (product.inStock === false) {
        logInfo(`group_add_item: product out of stock productId=${productId}`, { traceId: ctx.traceId });
        return { data: { error: `Sorry, "${product.name}" is currently out of stock.` } };
      }

      // Extract product logistics for new allocation algorithm
      const logistics = extractProductLogistics(product);
      if (!logistics) {
        logInfo(`group_add_item: product missing logistics productId=${productId} name="${product.name}"`, { traceId: ctx.traceId });
        return {
          data: {
            error: `Product "${product.name}" is missing required logistics data (manufacturer, unitsPerBox, boxesPerLayer, layersPerSurface). Cannot add to group order.`
          }
        };
      }

      try {
        // Use new strict allocation service
        const result = await addItemToGroupOrder({
          code,
          customerId: ctx.customerId,
          product: logistics,
          quantityUnits: quantity,
          productName: product.name,
          unitPrice: groupUnitPrice,
          imageUrl: product.images?.[0]?.src ?? null
        });

        if (!result.success) {
          logInfo(`group_add_item: allocation failed productId=${productId} code=${code}`, { 
            traceId: ctx.traceId, 
            error: result.error 
          });

          // Return detailed error message based on error code
          let userMessage = result.error?.message ?? 'Failed to add item to group order';
          
          if (result.error?.code === 'MANUFACTURER_MISMATCH') {
            userMessage = `This group order is locked to manufacturer "${result.error.details.groupOrderManufacturer}". Product "${product.name}" is from "${result.error.details.productManufacturer}".`;
          } else if (result.error?.code === 'OVERFLOW') {
            userMessage = `Cannot add ${quantity} units - would exceed group order capacity. ${result.error.message}`;
          } else if (result.error?.code === 'LAYER_LIMIT_CONFLICT') {
            userMessage = `Cannot add this product - it would reduce the allowed layers per surface below currently opened layers.`;
          }

          return { data: { error: userMessage, details: result.error } };
        }

        // Success - get updated group order status
        const go = await getGroupOrderStatus(code);
        logInfo(`group_add_item: success productId=${productId} code=${code}`, { 
          traceId: ctx.traceId,
          allocatedBoxes: result.allocatedBoxes,
          allocatedUnits: result.allocatedUnits,
          surfacesOpened: result.surfacesOpened,
          layersOpened: result.layersOpened
        });
        
        return { 
          data: {
            ...go,
            allocationResult: {
              allocatedBoxes: result.allocatedBoxes,
              allocatedUnits: result.allocatedUnits,
              surfacesOpened: result.surfacesOpened,
              layersOpened: result.layersOpened
            }
          }
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logError(`group_add_item: service error productId=${productId} code=${code}`, { traceId: ctx.traceId, err });
        return { data: { error: msg } };
      }
    }

    case 'group_remove_item': {
      const go = await removeGroupOrderItem(
        args.code as string,
        ctx.customerId,
        args.productId as string
      );
      return { data: go };
    }

    default:
      logError(`Unknown tool: ${name}`, { traceId: ctx.traceId });
      return { data: { error: `Unknown tool: ${name}` } };
  }
}
