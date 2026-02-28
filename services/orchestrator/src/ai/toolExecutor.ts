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
  deleteGroupOrderByCreator
} from '@taste-labs/db';
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

function productGroupOrderMetadata(product: WooProduct) {
  return {
    manufacturerId: product.manufacturerId ?? product.metadata?.manufacturerId,
    manufacturerName: product.manufacturerName ?? product.metadata?.manufacturerName,
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
      const products = await woo.searchProducts(
        (args.query as string) ?? '',
        { limit: (args.limit as number) ?? 6 }
      );
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
        args.moqTarget as number,
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
        manufacturerId: (args.manufacturerId as string | undefined) ?? undefined,
        limit: (args.limit as number | undefined) ?? 10
      });
      return { data: { orders } };
    }

    case 'group_best_match': {
      const productId = args.productId as string;
      const product = await woo.getProduct(productId);
      if (!product) return { data: { error: `Product ${productId} not found` } };

      const groupMeta = productGroupOrderMetadata(product);
      if (!groupMeta.manufacturerId) {
        return {
          data: {
            error: `Product "${product.name}" is missing manufacturer mapping, so I can't find compatible group orders.`
          }
        };
      }

      const matches = await findBestGroupOrdersForManufacturer({
        manufacturerId: String(groupMeta.manufacturerId),
        limit: (args.limit as number | undefined) ?? 3
      });

      return {
        data: {
          productId: product.id,
          productName: product.name,
          manufacturerId: String(groupMeta.manufacturerId),
          orders: matches
        }
      };
    }

    case 'group_add_item': {
      const productId = args.productId as string;
      const product = await woo.getProduct(productId);
      if (!product) return { data: { error: `Product ${productId} not found` } };

      // Validate purchasable & price
      if (product.purchasable === false) {
        return { data: { error: `Sorry, "${product.name}" is currently not available for purchase.` } };
      }
      const groupUnitPrice = parseFloat(product.price ?? '');
      if (!product.price || product.price.trim() === '' || isNaN(groupUnitPrice) || groupUnitPrice <= 0) {
        return { data: { error: `Sorry, "${product.name}" doesn't have a price set yet and can't be added.` } };
      }
      if (product.inStock === false) {
        return { data: { error: `Sorry, "${product.name}" is currently out of stock.` } };
      }

      const groupMeta = productGroupOrderMetadata(product);
      if (!groupMeta.manufacturerId) {
        return {
          data: {
            error: `Product "${product.name}" is missing manufacturer mapping. Group orders require products from one manufacturer.`
          }
        };
      }
      if (!groupMeta.boxesPerLayer || groupMeta.boxesPerLayer <= 0) {
        return {
          data: {
            error: `Product "${product.name}" is missing valid boxes-per-layer metadata required for MOQ tracking.`
          }
        };
      }

      const go = await addGroupOrderItem(args.code as string, ctx.customerId, {
        productId,
        variantId: (args.variantId as string) ?? null,
        name: product.name,
        imageUrl: product.images?.[0]?.src ?? null,
        unitPrice: groupUnitPrice,
        quantity: (args.quantity as number) ?? 1,
        metadata: groupMeta
      });
      return { data: go };
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
