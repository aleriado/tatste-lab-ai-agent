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
  addItemToGroupOrder,
  createImportOrder,
  getOpenImportOrders,
  addItemToImportOrder,
  checkoutImportOrder,
} from '@taste-labs/db';
import type { ProductLogistics } from '@taste-labs/db/src/groupOrder/types';
import type { SessionContext, CartSnapshot } from '@taste-labs/shared';
import { getPaymentAdapter } from '../adapters/payment';
import { getAvailableOrderTypes } from './orderTypeRouter';
import { validateCartCheckout } from './interventionGates';
import { logInfo, logError } from '../logger';

export interface ToolContext {
  customerId: string;
  traceId: string;
  sessionContext?: SessionContext;
}

function buildDefaultSessionContext(customerId: string): SessionContext {
  return {
    sessionId: '',
    customerId,
    userType: 'private_consumer',
    currentPage: 'catalog',
    shareSuggestionsCount: 0,
    shareSuggestionsPerPage: {},
    activeGroupOrders: [],
    activeImportOrders: [],
  };
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
function extractProductLogistics(product: WooProduct): ProductLogistics | { missingFields: string[] } {
  const manufacturer = product.manufacturer ?? product.metadata?.manufacturer as string | undefined;
  const unitsPerBox = product.unitsPerBox ?? product.metadata?.unitsPerBox as number | undefined;
  const boxesPerLayer = product.boxesPerLayer ?? product.metadata?.boxesPerLayer as number | undefined;
  const layersPerSurface = product.layersPerSurface ?? product.metadata?.layersPerSurface as number | undefined;
  const boxesPerSurface = product.boxesPerSurface ?? product.metadata?.boxesPerSurface as number | undefined;

  const missingFields: string[] = [];
  if (!manufacturer || typeof manufacturer !== 'string' || manufacturer.trim() === '') missingFields.push('manufacturer (יצרן)');
  if (!unitsPerBox || typeof unitsPerBox !== 'number' || unitsPerBox <= 0) missingFields.push('unitsPerBox (יחידות בקרטון)');
  if (!boxesPerLayer || typeof boxesPerLayer !== 'number' || boxesPerLayer <= 0) missingFields.push('boxesPerLayer (קרטונים בשכבה)');
  if (!layersPerSurface || typeof layersPerSurface !== 'number' || layersPerSurface <= 0) missingFields.push('layersPerSurface (שכבות במשטח)');

  if (missingFields.length > 0) {
    return { missingFields };
  }

  const moqBoxesRaw = product.metadata?.groupOrderMoqBoxes ?? (product as { groupOrderMoqBoxes?: number }).groupOrderMoqBoxes;
  const moqBoxes = typeof moqBoxesRaw === 'number' && moqBoxesRaw > 0 ? moqBoxesRaw : undefined;

  return {
    productId: product.id,
    variantId: null,
    name: product.name,
    manufacturer: (manufacturer as string).trim(),
    unitsPerBox: unitsPerBox as number,
    boxesPerLayer: boxesPerLayer as number,
    layersPerSurface: layersPerSurface as number,
    boxesPerSurface: boxesPerSurface ?? ((boxesPerLayer as number) * (layersPerSurface as number)),
    ...(moqBoxes != null && { moqBoxes }),
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
      const isBrowse = !query.trim();
      if (isBrowse && normalizedLimit < 50) normalizedLimit = 100;
      const maxPrice = Number(args.maxPrice);
      const minPrice = Number(args.minPrice);
      const manufacturer = typeof args.manufacturer === 'string' && args.manufacturer.trim() ? args.manufacturer.trim() : undefined;
      const filters = {
        limit: normalizedLimit,
        ...(Number.isFinite(maxPrice) && maxPrice >= 0 && { maxPrice }),
        ...(Number.isFinite(minPrice) && minPrice >= 0 && { minPrice }),
        ...(manufacturer && { manufacturer }),
      };
      if (typeof woo.searchProductsWithMeta === 'function') {
        const meta = await woo.searchProductsWithMeta(query, filters);
        return {
          data: {
            products: meta.products,
            matchType: meta.matchType,
            reason: meta.reason,
          },
          products: meta.products,
        };
      }
      const products = await woo.searchProducts(query, filters);
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
      const productId = args.productId as string;
      const sameManufacturerOnly = args.sameManufacturerOnly === true;
      const related = await woo.getRelatedProducts(productId, { sameManufacturerOnly });
      const capped = related.slice(0, 3); // max 3 recommendations
      return { data: capped, products: capped };
    }

    // ── Cart tools ──
    case 'cart_add_item': {
      const productId = args.productId as string;
      const variantId = (args.variantId as string) ?? null;
      const orderType = (args.orderType as 'regular' | 'stock') ?? 'regular';

      const requested = typeof args.quantity === 'number' && Number.isInteger(args.quantity) && args.quantity > 0
        ? Math.min(args.quantity, 9999)
        : 1;
      const quantity = requested;

      logInfo(`cart_add_item: productId=${productId}, quantity=${quantity}, orderType=${orderType}, ai_requested_qty=${args.quantity}`, { traceId: ctx.traceId });

      const product = await woo.getProduct(productId);
      if (!product) {
        return {
          data: {
            error: `Product ${productId} not found in catalog. When the user replied with only a number (quantity), use the productId from your last get_order_type_options result (available.productId), not from another source.`,
            reason: 'not_found'
          }
        };
      }

      if (product.purchasable === false) {
        return { data: { error: `Sorry, "${product.name}" is currently not available for purchase.`, reason: 'not_purchasable' } };
      }
      if (product.inStock === false) {
        return { data: { error: `Sorry, "${product.name}" is currently out of stock.`, reason: 'out_of_stock' } };
      }

      // Use unitPrice from args (from get_order_type_options); fallback to product price by order type
      let unitPrice: number;
      if (typeof args.unitPrice === 'number' && !isNaN(args.unitPrice) && args.unitPrice > 0) {
        unitPrice = args.unitPrice;
      } else {
        const retail = parseFloat((product.retailPrice ?? product.price ?? '').toString());
        const wholesale = parseFloat((product.wholesalePrice ?? '').toString());
        unitPrice = orderType === 'stock' && !isNaN(wholesale) && wholesale > 0 ? wholesale : retail;
      }
      if (isNaN(unitPrice) || unitPrice <= 0) {
        return { data: { error: `Sorry, "${product.name}" doesn't have a price set for ${orderType} and can't be added to cart.`, reason: 'no_price' } };
      }

      const cart = await addCartItem(ctx.customerId, {
        productId,
        variantId,
        orderType,
        name: product.name,
        imageUrl: product.images?.[0]?.src ?? null,
        unitPrice,
        quantity,
      });

      const summary = computeCartSummary(cart);
      return { data: { message: `Added ${quantity}x ${product.name} (${orderType}) to cart`, cart: summary } };
    }

    case 'cart_remove_item': {
      const orderType = args.orderType as 'regular' | 'stock' | undefined;
      const cart = await removeCartItem(
        ctx.customerId,
        args.productId as string,
        (args.variantId as string) ?? null,
        orderType
      );
      const summary = computeCartSummary(cart);
      return { data: { message: 'Item removed from cart', cart: summary } };
    }

    case 'cart_update_quantity': {
      const orderType = args.orderType as 'regular' | 'stock' | undefined;
      const cart = await updateCartItemQty(
        ctx.customerId,
        args.productId as string,
        args.quantity as number,
        (args.variantId as string) ?? null,
        orderType
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

      // AIS-08: Validate minimum order quantities before proceeding
      const validation = validateCartCheckout(summary as unknown as CartSnapshot, {});
      if (!validation.allowed) {
        return {
          data: {
            error: `Cannot proceed to checkout: ${validation.summary}`,
            shortfalls: validation.shortfalls,
            gate: 'AIS-08',
          },
        };
      }

      const payment = getPaymentAdapter();
      const result = await payment.createCheckoutSession({
        customerId: ctx.customerId,
        cartTotal: parseFloat(summary.total),
        currency: summary.currency,
        splitPayment: true,
        meta: { items: summary.items }
      });

      // AIS-07: Post-order suggestions — related products for purchased items
      const purchasedIds = summary.items.map((i) => i.productId);
      let postOrderProducts: WooProduct[] = [];
      try {
        const seen = new Set<string>(purchasedIds);
        for (const pid of purchasedIds) {
          const related = await woo.getRelatedProducts(pid, {});
          for (const p of related) {
            if (!seen.has(p.id)) {
              seen.add(p.id);
              postOrderProducts.push(p);
            }
            if (postOrderProducts.length >= 3) break;
          }
          if (postOrderProducts.length >= 3) break;
        }
      } catch {
        // Non-critical — proceed without suggestions
      }

      return {
        data: {
          message: 'Checkout session created',
          paymentUrl: result.paymentUrl,
          totalAmount: result.totalAmount,
          amountDueNow: result.amountDueNow,
          amountDueLater: result.amountDueLater,
          currency: result.currency,
          ...(postOrderProducts.length > 0 && {
            postOrderSuggestions: {
              message: 'You might also enjoy these products',
              products: postOrderProducts.map((p) => ({ id: p.id, name: p.name })),
            },
          }),
        },
        products: postOrderProducts.length > 0 ? postOrderProducts : undefined,
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
      // Group tiered pricing: < 2 boxes → importPricePer2Boxes, >= 2 boxes → importPricePerSurface. Service picks after allocation.
      const importPer2 = parseFloat((product.importPricePer2Boxes ?? '').toString());
      const importPerSurface = parseFloat((product.importPricePerSurface ?? '').toString());
      const hasTierPrices = !isNaN(importPer2) && importPer2 > 0 && !isNaN(importPerSurface) && importPerSurface > 0;
      const wholesale = parseFloat((product.wholesalePrice ?? '').toString());
      const retail = parseFloat((product.retailPrice ?? product.price ?? '').toString());
      const fallbackUnitPrice = !isNaN(wholesale) && wholesale > 0 ? wholesale : retail;
      if (!hasTierPrices && (isNaN(fallbackUnitPrice) || fallbackUnitPrice <= 0)) {
        logInfo(`group_add_item: product missing/invalid price productId=${productId}`, { traceId: ctx.traceId });
        return { data: { error: `Sorry, "${product.name}" doesn't have a group/import price set yet and can't be added to the group order.` } };
      }
      // Always pass a positive fallback so service can use it when tier formula yields 0 or invalid
      const groupUnitPrice = Number.isFinite(fallbackUnitPrice) && fallbackUnitPrice > 0 ? fallbackUnitPrice : 0;
      if (product.inStock === false) {
        logInfo(`group_add_item: product out of stock productId=${productId}`, { traceId: ctx.traceId });
        return { data: { error: `Sorry, "${product.name}" is currently out of stock.` } };
      }

      // Extract product logistics for new allocation algorithm
      const logistics = extractProductLogistics(product);
      if (!logistics || 'missingFields' in logistics) {
        const missing = logistics && 'missingFields' in logistics ? logistics.missingFields : ['unknown'];
        logInfo(`group_add_item: product missing logistics productId=${productId} name="${product.name}" missing=${missing.join(', ')}`, { traceId: ctx.traceId });
        return {
          data: {
            error: `Cannot add "${product.name}" to group order — missing required logistics fields: ${missing.join(', ')}. Please update the product data in HubSpot.`
          }
        };
      }

      try {
        // Use new strict allocation service. Tier prices: < 2 boxes → importPricePer2Boxes, >= 2 → importPricePerSurface.
        const result = await addItemToGroupOrder({
          code,
          customerId: ctx.customerId,
          product: logistics,
          quantityUnits: quantity,
          productName: product.name,
          unitPrice: groupUnitPrice,
          imageUrl: product.images?.[0]?.src ?? null,
          ...(hasTierPrices && {
            importPricePer2Boxes: importPer2,
            importPricePerSurface: importPerSurface,
          }),
        });

        if (!result.success) {
          logInfo(`group_add_item: allocation failed productId=${productId} code=${code}`, { 
            traceId: ctx.traceId, 
            error: result.error 
          });

          // Return detailed error message based on error code
          let userMessage = result.error?.message ?? 'Failed to add item to group order';
          
          if (result.error?.code === 'MANUFACTURER_MISMATCH') {
            const locked = (result.error.details?.groupOrderManufacturer as string) ?? 'this manufacturer';
            const productMfr = (result.error.details?.productManufacturer as string) ?? 'another';
            userMessage = `This group order is locked to products from ${locked}. "${product.name}" is made by ${productMfr}, so it can't be added here. Would you like to see what's available from ${locked} instead?`;
          } else if (result.error?.code === 'BELOW_MOQ') {
            const moqBoxes = (result.error.details?.moqBoxes as number) ?? 1;
            userMessage = `The minimum order for "${product.name}" is ${moqBoxes} boxes. You've asked for fewer. Would you like to go with the minimum of ${moqBoxes} boxes instead?`;
          } else if (result.error?.code === 'OVERFLOW') {
            userMessage = `Only limited space is left on this surface. You asked for more than fits. Maximum you can add here is in the details. Would you like to take the remaining space, or join a new surface for the full amount? ${result.error.message}`;
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

    case 'group_checkout': {
      const code = args.code as string;
      const go = await getGroupOrderStatus(code);

      if (go.status !== 'MOQ_REACHED') {
        return {
          data: {
            error: `Group order ${code} has not reached MOQ yet (status: ${go.status}). MOQ must be reached before checkout.`,
            moqCurrent: go.moqCurrent,
            moqTarget: go.moqTarget
          }
        };
      }

      // Find this participant's cost
      const myEntry = go.participantCosts?.find(p => p.customerId === ctx.customerId);
      if (!myEntry || parseFloat(myEntry.total) <= 0) {
        return {
          data: {
            error: `You don't have any items in group order ${code}. Add products before checking out.`
          }
        };
      }

      const myTotal = parseFloat(myEntry.total);
      const payment = getPaymentAdapter();
      const result = await payment.createCheckoutSession({
        customerId: ctx.customerId,
        cartTotal: myTotal,
        currency: 'ILS',
        splitPayment: true,
        groupOrderId: go.id,
        meta: {
          groupOrderCode: code,
          products: myEntry.products,
          participantShare: myEntry.total,
          orderTotal: go.participantCosts?.reduce((s, p) => s + parseFloat(p.total), 0).toFixed(2)
        }
      });

      // AIS-07: Post-order suggestions — related products from order's surfaces
      const groupProductIds = [
        ...new Set(
          (go.surfaces ?? []).flatMap((s) => s.layers.map((l) => l.productId)).filter(Boolean)
        ),
      ];
      let groupPostOrderProducts: WooProduct[] = [];
      try {
        const seen = new Set<string>(groupProductIds);
        for (const pid of groupProductIds) {
          const related = await woo.getRelatedProducts(pid, {});
          for (const p of related) {
            if (!seen.has(p.id)) {
              seen.add(p.id);
              groupPostOrderProducts.push(p);
            }
            if (groupPostOrderProducts.length >= 3) break;
          }
          if (groupPostOrderProducts.length >= 3) break;
        }
      } catch {
        // Non-critical — proceed without suggestions
      }

      return {
        data: {
          message: `Checkout ready for group order ${code}`,
          groupOrderCode: code,
          yourTotal: myEntry.total,
          products: myEntry.products,
          paymentUrl: result.paymentUrl,
          amountDueNow: result.amountDueNow,
          amountDueLater: result.amountDueLater,
          currency: result.currency,
          ...(groupPostOrderProducts.length > 0 && {
            postOrderSuggestions: {
              message: 'You might also enjoy these products',
              products: groupPostOrderProducts.map((p) => ({ id: p.id, name: p.name })),
            },
          }),
        },
        products: groupPostOrderProducts.length > 0 ? groupPostOrderProducts : undefined,
      };
    }

    case 'group_remove_item': {
      const go = await removeGroupOrderItem(
        args.code as string,
        ctx.customerId,
        args.productId as string
      );
      return { data: go };
    }

    // ── M2: Order type options ──
    case 'get_order_type_options': {
      const productId = args.productId as string;
      const sessionContext = ctx.sessionContext ?? buildDefaultSessionContext(ctx.customerId);

      try {
        const result = await getAvailableOrderTypes(productId, ctx.customerId, sessionContext);
        return { data: result };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logError(`get_order_type_options failed productId=${productId}`, { traceId: ctx.traceId, err });
        return { data: { error: msg } };
      }
    }

    // ── M2: Import order tools ──
    case 'import_order_create': {
      const deadlineHours = args.deadlineHours as number | undefined;

      try {
        const result = await createImportOrder(ctx.customerId, deadlineHours);
        logInfo(`import_order_create: success code=${result.code}`, { traceId: ctx.traceId });
        // Return full group-order shape so UI can show surfaces, layers, MOQ (same as group order status).
        const status = await getGroupOrderStatus(result.code);
        return { data: status };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logError('import_order_create failed', { traceId: ctx.traceId, err });
        return { data: { error: msg } };
      }
    }

    case 'import_order_check': {
      const productId = args.productId as string;
      let customerId = (args.customerId as string) ?? ctx.customerId;
      if (customerId === 'private_consumer' || customerId === 'retailer') customerId = ctx.customerId;

      const product = await woo.getProduct(productId);
      if (!product) return { data: { error: `Product ${productId} not found` } };

      const manufacturer =
        product.manufacturer ??
        (product.metadata?.manufacturer as string | undefined);
      if (!manufacturer) {
        return {
          data: {
            error: `Product "${product.name}" has no manufacturer mapping`,
            productId,
            productName: product.name,
            existingOrders: [],
          },
        };
      }

      try {
        const orders = await getOpenImportOrders(customerId, manufacturer.trim());
        return {
          data: {
            productId,
            productName: product.name,
            manufacturer: manufacturer.trim(),
            existingOrders: orders,
          },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logError(`import_order_check failed productId=${productId}`, { traceId: ctx.traceId, err });
        return { data: { error: msg } };
      }
    }

    case 'import_add_item': {
      const code = args.code as string;
      const productId = args.productId as string;
      const quantity = (args.quantity as number) ?? 1;

      const product = await woo.getProduct(productId);
      if (!product) {
        logInfo(`import_add_item: product not found productId=${productId}`, { traceId: ctx.traceId });
        return { data: { error: `Product ${productId} not found` } };
      }

      if (product.purchasable === false) {
        return { data: { error: `Sorry, "${product.name}" is currently not available for purchase.` } };
      }
      if (product.inStock === false) {
        return { data: { error: `Sorry, "${product.name}" is currently out of stock.` } };
      }

      const logistics = extractProductLogistics(product);
      if (!logistics || 'missingFields' in logistics) {
        const missing = logistics && 'missingFields' in logistics ? logistics.missingFields : ['unknown'];
        logInfo(`import_add_item: missing logistics productId=${productId} missing=${missing.join(', ')}`, { traceId: ctx.traceId });
        return {
          data: {
            error: `Cannot add "${product.name}" to import order — missing required logistics fields: ${missing.join(', ')}. Please update the product data in HubSpot.`,
          },
        };
      }

      // Same tier pricing as group orders: importPricePer2Boxes / importPricePerSurface or fallback unit price
      const importPer2 = parseFloat((product.importPricePer2Boxes ?? '').toString());
      const importPerSurface = parseFloat((product.importPricePerSurface ?? '').toString());
      const hasTierPrices = !isNaN(importPer2) && importPer2 > 0 && !isNaN(importPerSurface) && importPerSurface > 0;
      const wholesale = parseFloat((product.wholesalePrice ?? '').toString());
      const retail = parseFloat((product.retailPrice ?? product.price ?? '').toString());
      const fallbackUnitPrice = !isNaN(wholesale) && wholesale > 0 ? wholesale : retail;
      if (!hasTierPrices && (isNaN(fallbackUnitPrice) || fallbackUnitPrice <= 0)) {
        logInfo(`import_add_item: product missing/invalid price productId=${productId}`, { traceId: ctx.traceId });
        return {
          data: {
            error: `Sorry, "${product.name}" doesn't have a group/import price set yet and can't be added to the import order.`,
          },
        };
      }
      const importUnitPrice = Number.isFinite(fallbackUnitPrice) && fallbackUnitPrice > 0 ? fallbackUnitPrice : 0;

      // Drop-import: whole layers only — quantity must be a multiple of units per layer
      const unitsPerLayer = logistics.boxesPerLayer * logistics.unitsPerBox;
      if (quantity <= 0 || quantity % unitsPerLayer !== 0) {
        return {
          data: {
            error: `In a drop-import order, layers can't be split — each layer is committed in full. "${product.name}" layers contain ${logistics.boxesPerLayer} boxes each (${unitsPerLayer} units per layer). How many full layers would you like?`,
            code: 'PARTIAL_LAYER',
            details: { boxesPerLayer: logistics.boxesPerLayer, unitsPerBox: logistics.unitsPerBox, unitsPerLayer },
          },
        };
      }

      try {
        const result = await addItemToImportOrder(code, ctx.customerId, logistics, quantity, {
          productName: product.name,
          unitPrice: importUnitPrice,
          imageUrl: product.images?.[0]?.src ?? null,
          ...(hasTierPrices && {
            importPricePer2Boxes: importPer2,
            importPricePerSurface: importPerSurface,
          }),
        });

        if (!result.success) {
          logInfo(`import_add_item: allocation failed productId=${productId} code=${code}`, {
            traceId: ctx.traceId,
            error: result.error,
          });

          let userMessage = result.error?.message ?? 'Failed to add item to import order';
          if (result.error?.code === 'MANUFACTURER_MISMATCH') {
            const locked = (result.error.details?.groupOrderManufacturer as string) ?? 'this manufacturer';
            const productMfr = (result.error.details?.productManufacturer as string) ?? 'another';
            userMessage = `This import order is locked to products from ${locked}. "${product.name}" is made by ${productMfr}, so it can't be added here. Would you like to see what's available from ${locked} instead?`;
          } else if (result.error?.code === 'OVERFLOW') {
            userMessage = `You've asked for more layers than fit on the remaining surface. Only limited space is left. Options: use the remaining space for this product, or use fewer layers and leave room for another product. ${result.error.message}`;
          } else if (result.error?.code === 'SINGLE_USER_VIOLATION') {
            userMessage = result.error.message;
          }

          return { data: { error: userMessage, details: result.error } };
        }

        const status = await getGroupOrderStatus(code);
        logInfo(`import_add_item: success productId=${productId} code=${code}`, {
          traceId: ctx.traceId,
          allocatedBoxes: result.allocatedBoxes,
          allocatedUnits: result.allocatedUnits,
        });

        const layersAdded = result.allocatedBoxes / logistics.boxesPerLayer;
        return {
          data: {
            message: `Your ${layersAdded} layer(s) of ${product.name} are confirmed. ${result.allocatedBoxes} boxes (${result.allocatedUnits} items) added to import order ${code}.`,
            ...status,
            allocationResult: {
              allocatedBoxes: result.allocatedBoxes,
              allocatedUnits: result.allocatedUnits,
              layersAdded,
              surfacesOpened: result.surfacesOpened,
              layersOpened: result.layersOpened,
            },
          },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logError(`import_add_item: service error productId=${productId} code=${code}`, { traceId: ctx.traceId, err });
        return { data: { error: msg } };
      }
    }

    case 'import_order_list': {
      let customerId = (args.customerId as string) ?? ctx.customerId;
      if (customerId === 'private_consumer' || customerId === 'retailer') customerId = ctx.customerId;
      try {
        const orders = await getOpenImportOrders(customerId);
        return { data: { orders, customerId } };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logError(`import_order_list failed customerId=${customerId}`, { traceId: ctx.traceId, err });
        return { data: { error: msg, orders: [] } };
      }
    }

    case 'import_order_status': {
      const code = args.code as string;
      try {
        // Import orders are GroupOrders in DB; use same status shape as group order for unified UI.
        const status = await getGroupOrderStatus(code);
        if (!status.isImport) {
          return { data: { error: `Order ${code} is not an import order. Use group_status for group orders.` } };
        }
        return { data: status };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logError(`import_order_status failed code=${code}`, { traceId: ctx.traceId, err });
        return { data: { error: msg } };
      }
    }

    case 'import_remove_item': {
      const code = args.code as string;
      const productId = args.productId as string;
      try {
        const existing = await getGroupOrderStatus(code);
        if (!existing.isImport) {
          return { data: { error: `Order ${code} is not an import order. Use group_remove_item for group orders.` } };
        }
        if (existing.createdByCustomerId !== ctx.customerId) {
          return { data: { error: 'Only the import order creator can remove items from this order.' } };
        }
        const status = await removeGroupOrderItem(code, ctx.customerId, productId);
        return { data: status };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logError(`import_remove_item failed code=${code} productId=${productId}`, { traceId: ctx.traceId, err });
        return { data: { error: msg } };
      }
    }

    case 'import_order_delete': {
      const code = args.code as string;
      try {
        const existing = await getGroupOrderStatus(code);
        if (!existing.isImport) {
          return { data: { error: `Order ${code} is not an import order. Use group order delete for group orders.` } };
        }
        if (existing.createdByCustomerId !== ctx.customerId) {
          return { data: { error: 'Only the import order creator can delete this order.' } };
        }
        const result = await deleteGroupOrderByCreator(code, ctx.customerId);
        return { data: result };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logError(`import_order_delete failed code=${code}`, { traceId: ctx.traceId, err });
        return { data: { error: msg } };
      }
    }

    // ── M2: Universal order status (AIS-06) ──
    case 'order_status': {
      const code = args.code as string | undefined;
      const orderId = args.orderId as string | undefined;

      if (!code && !orderId) {
        return { data: { error: 'Please provide an order code or order ID to look up status.' } };
      }

      const lookup = code ?? orderId!;

      // Group and import orders share the same table; getGroupOrderStatus returns both with isImport flag.
      try {
        const goStatus = await getGroupOrderStatus(lookup);
        return { data: goStatus };
      } catch {
        return { data: { error: `Order "${lookup}" not found. Please check the code or ID.` } };
      }
    }

    default:
      logError(`Unknown tool: ${name}`, { traceId: ctx.traceId });
      return { data: { error: `Unknown tool: ${name}` } };
  }
}
