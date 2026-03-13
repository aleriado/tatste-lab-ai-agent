/**
 * Intervention Gate Engine (AIS-01 through AIS-04)
 *
 * Evaluates intervention protocols before the agent recommends purchase paths.
 * Sits between the tool executor and business logic, filtering and redirecting
 * actions based on product state, active orders, and session context.
 */

import { getWooAdapter } from '../adapters/woocommerce';
import type { WooProduct } from '../adapters/woocommerce';
import {
  listDiscoverableGroupOrders,
  getOpenImportOrders,
} from '@taste-labs/db';
import type {
  SessionContext,
  InterventionResult,
  AvailableOrderTypes,
  OrderTypeOption,
  ProductCard,
  CartSnapshot,
  CartItemSnapshot,
} from '@taste-labs/shared';
import { logInfo } from '../logger';

// ── Internal types ──

interface ProductWithState {
  id: string;
  name: string;
  manufacturer: string;
  productState: 'ACTIVE_IMPORTED' | 'CATALOG_EXTENSION';
  retailPrice?: string;
  wholesalePrice?: string;
  importPricePerSurface?: string;
  importPricePer2Boxes?: string;
  salePrice?: string;
  unitsPerBox?: number;
  boxesPerLayer?: number;
  layersPerSurface?: number;
  dreamStage?: string;
}

interface PriceDisclosureResult {
  allowed: boolean;
  prices: {
    retail?: string;
    wholesale?: string;
    importPerSurface?: string;
    importPer2Boxes?: string;
  };
  reason?: string;
}

interface ActiveGroupOrderInfo {
  code: string;
  manufacturer: string;
  moqCurrent: number;
  moqTarget: number;
  remainingToTarget: number;
  participantCount: number;
  totalBoxesFilled: number;
}

// ── Helpers ──

/**
 * Resolve a WooProduct into a ProductWithState.
 * Defaults to ACTIVE_IMPORTED when the product has no explicit state.
 */
function resolveProductState(product: WooProduct): ProductWithState {
  const manufacturer =
    product.manufacturer ??
    (product.metadata?.manufacturer as string | undefined) ??
    '';

  // Determine product state from status field or metadata
  let productState: 'ACTIVE_IMPORTED' | 'CATALOG_EXTENSION' = 'ACTIVE_IMPORTED';
  const rawState =
    (product.metadata?.productState as string | undefined) ??
    (product.status as string | undefined);
  if (rawState === 'CATALOG_EXTENSION') {
    productState = 'CATALOG_EXTENSION';
  }

  return {
    id: product.id,
    name: product.name,
    manufacturer: manufacturer.trim(),
    productState,
    retailPrice: product.retailPrice ?? product.price,
    wholesalePrice: product.wholesalePrice,
    importPricePerSurface: product.importPricePerSurface,
    importPricePer2Boxes: product.importPricePer2Boxes,
    salePrice: product.salePrice,
    unitsPerBox: product.unitsPerBox ?? (product.metadata?.unitsPerBox as number | undefined),
    boxesPerLayer: product.boxesPerLayer ?? (product.metadata?.boxesPerLayer as number | undefined),
    layersPerSurface: product.layersPerSurface ?? (product.metadata?.layersPerSurface as number | undefined),
    dreamStage: product.metadata?.dreamStage as string | undefined,
  };
}

function hasLogisticsMetadata(p: ProductWithState): boolean {
  return (
    typeof p.unitsPerBox === 'number' &&
    p.unitsPerBox > 0 &&
    typeof p.boxesPerLayer === 'number' &&
    p.boxesPerLayer > 0 &&
    typeof p.layersPerSurface === 'number' &&
    p.layersPerSurface > 0
  );
}

function hasValidPrice(price: string | undefined): boolean {
  if (!price || price.trim() === '') return false;
  const n = parseFloat(price);
  return !isNaN(n) && n > 0;
}

// ── AIS-01: Product State Verification ──

/**
 * AIS-01 — Verify product state before suggesting purchase paths.
 * CATALOG_EXTENSION products are blocked from all purchase paths.
 */
function evaluateProductState(product: ProductWithState): InterventionResult {
  if (product.productState === 'CATALOG_EXTENSION') {
    return {
      gate: 'AIS-01',
      action: 'block',
      message: `"${product.name}" is on the Dream List and not yet available for purchase.`,
      redirectTo: 'dream_list',
      data: {
        productId: product.id,
        productState: product.productState,
        dreamStage: product.dreamStage,
      },
    };
  }

  return {
    gate: 'AIS-01',
    action: 'allow',
    data: { productId: product.id, productState: product.productState },
  };
}

// ── AIS-02: Group Order Recommendation ──

/**
 * AIS-02 — Check for active group orders for the same manufacturer.
 * Recommends joining when beneficial (closer to MOQ, more participants).
 */
async function evaluateGroupOrderRecommendation(
  product: ProductWithState,
  customerId: string,
  sessionContext: SessionContext,
): Promise<{ intervention: InterventionResult; activeOrders: ActiveGroupOrderInfo[] }> {
  if (!product.manufacturer) {
    return {
      intervention: { gate: 'AIS-02', action: 'allow' },
      activeOrders: [],
    };
  }

  const groupOrders = await listDiscoverableGroupOrders({
    manufacturerId: product.manufacturer,
    limit: 5,
  });

  if (groupOrders.length === 0) {
    return {
      intervention: { gate: 'AIS-02', action: 'allow' },
      activeOrders: [],
    };
  }

  const activeOrders: ActiveGroupOrderInfo[] = groupOrders.map((go) => ({
    code: go.code,
    manufacturer: go.manufacturer ?? product.manufacturer,
    moqCurrent: go.moqCurrent,
    moqTarget: go.moqTarget,
    remainingToTarget: go.remainingToTarget,
    participantCount: go.participantCount,
    totalBoxesFilled: go.totalBoxesFilled,
  }));

  // Find the best group order (closest to MOQ completion)
  const best = activeOrders.reduce((a, b) =>
    a.remainingToTarget <= b.remainingToTarget ? a : b,
  );

  return {
    intervention: {
      gate: 'AIS-02',
      action: 'inform',
      message: `There are ${activeOrders.length} active group order(s) for ${product.manufacturer}. The closest to completion is ${best.code} (${best.remainingToTarget} surface(s) remaining).`,
      data: {
        activeGroupOrders: activeOrders,
        recommendedCode: best.code,
      },
    },
    activeOrders,
  };
}

// ── AIS-03: Suboptimal Path Blocking ──

/**
 * AIS-03 — Block suboptimal purchase paths.
 *
 * Two checks:
 * 1. Low-volume wholesale that would be cheaper as regular order
 * 2. Mismatched manufacturer for group order
 */
function evaluateSuboptimalPath(
  product: ProductWithState,
  orderType: 'regular' | 'stock' | 'group' | 'import',
  quantity?: number,
  groupOrderManufacturer?: string,
): InterventionResult {
  // Check 1: Low-volume wholesale cheaper as regular
  if (orderType === 'stock' && quantity !== undefined) {
    const retailNum = parseFloat(product.retailPrice ?? '');
    const wholesaleNum = parseFloat(product.wholesalePrice ?? '');
    if (!isNaN(retailNum) && !isNaN(wholesaleNum) && retailNum > 0 && wholesaleNum > 0) {
      // If the wholesale total for a small quantity is higher than retail
      // (e.g. MOQ overhead makes it more expensive), redirect to regular
      if (quantity === 1 && retailNum <= wholesaleNum) {
        return {
          gate: 'AIS-03',
          action: 'redirect',
          message: `For ${quantity} unit(s), a regular order at ₪${retailNum} per unit is more cost-effective than wholesale.`,
          redirectTo: 'regular',
          data: { retailPrice: retailNum, wholesalePrice: wholesaleNum, quantity },
        };
      }
    }
  }

  // Check 2: Manufacturer mismatch for group orders
  if (
    (orderType === 'group' || orderType === 'import') &&
    groupOrderManufacturer &&
    product.manufacturer &&
    product.manufacturer.toLowerCase() !== groupOrderManufacturer.toLowerCase()
  ) {
    return {
      gate: 'AIS-03',
      action: 'block',
      message: `This group order is for ${groupOrderManufacturer}. "${product.name}" is from ${product.manufacturer} and cannot be added.`,
      data: {
        productManufacturer: product.manufacturer,
        groupOrderManufacturer,
      },
    };
  }

  return { gate: 'AIS-03', action: 'allow' };
}

// ── AIS-04: Price Disclosure Rules ──

/**
 * AIS-04 — Enforce price disclosure rules.
 *
 * - CATALOG_EXTENSION: never disclose any pricing
 * - ACTIVE_IMPORTED: return the correct tier for the selected order type
 */
function checkPriceDisclosure(
  product: ProductWithState,
  orderType: 'regular' | 'stock' | 'group' | 'import',
): PriceDisclosureResult {
  // CATALOG_EXTENSION — no prices ever
  if (product.productState === 'CATALOG_EXTENSION') {
    return {
      allowed: false,
      prices: {},
      reason: 'Price disclosure is not permitted for Dream List products.',
    };
  }

  // ACTIVE_IMPORTED — return the correct tier
  const prices: PriceDisclosureResult['prices'] = {};

  switch (orderType) {
    case 'regular':
      if (hasValidPrice(product.retailPrice)) prices.retail = product.retailPrice;
      break;
    case 'stock':
      if (hasValidPrice(product.wholesalePrice)) prices.wholesale = product.wholesalePrice;
      break;
    case 'group':
    case 'import':
      if (hasValidPrice(product.importPricePerSurface)) prices.importPerSurface = product.importPricePerSurface;
      if (hasValidPrice(product.importPricePer2Boxes)) prices.importPer2Boxes = product.importPricePer2Boxes;
      break;
  }

  return { allowed: true, prices };
}

/**
 * Strip all pricing fields from a ProductCard for CATALOG_EXTENSION products.
 * Used by the tool executor to enforce AIS-04 before returning data to the LLM.
 */
export function stripPricesForCatalogExtension(card: ProductCard): ProductCard {
  if (card.productState !== 'CATALOG_EXTENSION') return card;

  return {
    ...card,
    price: undefined,
    retailPrice: undefined,
    wholesalePrice: undefined,
    importPricePerSurface: undefined,
    importPricePer2Boxes: undefined,
    salePrice: undefined,
    costPrice: undefined,
  };
}

// ── Main evaluation engine ──

/**
 * evaluateOrderTypeOptions — Main entry point for the intervention gate engine.
 *
 * Runs AIS-01 (product state), AIS-02 (group order check), AIS-04 (price disclosure)
 * and returns filtered AvailableOrderTypes with recommendations.
 */
export async function evaluateOrderTypeOptions(
  productId: string,
  customerId: string,
  sessionContext: SessionContext,
): Promise<AvailableOrderTypes> {
  const woo = getWooAdapter();
  const rawProduct = await woo.getProduct(productId);

  if (!rawProduct) {
    return {
      productId,
      productName: 'Unknown',
      productState: 'ACTIVE_IMPORTED',
      manufacturer: '',
      types: [],
    };
  }

  const product = resolveProductState(rawProduct);

  logInfo(`[InterventionGates] evaluateOrderTypeOptions productId=${productId} state=${product.productState}`, {});

  // ── AIS-01: Product state verification ──
  const ais01 = evaluateProductState(product);
  if (ais01.action === 'block') {
    // CATALOG_EXTENSION — no purchase types, only Dream List
    return {
      productId: product.id,
      productName: product.name,
      productState: product.productState,
      manufacturer: product.manufacturer,
      types: [],
    };
  }

  // ── AIS-02: Group order recommendation (runs in parallel with import check) ──
  const [ais02Result, openImportOrders] = await Promise.all([
    evaluateGroupOrderRecommendation(product, customerId, sessionContext),
    product.manufacturer
      ? getOpenImportOrders(customerId, product.manufacturer)
      : Promise.resolve([]),
  ]);

  // ── Build available order types ──
  const types: OrderTypeOption[] = [];

  // Regular — available for ACTIVE_IMPORTED with retail price
  const hasRetail = hasValidPrice(product.retailPrice);
  if (hasRetail) {
    const disclosure = checkPriceDisclosure(product, 'regular');
    types.push({
      type: 'regular',
      available: true,
      recommended: false,
      pricePerUnit: disclosure.prices.retail,
      reason: 'Standard retail purchase with no minimum quantity.',
    });
  }

  // Stock — available when product has wholesale price (MOQ in boxes from env)
  const hasWholesale = hasValidPrice(product.wholesalePrice);
  if (hasWholesale) {
    const stockMoqBoxes = getStockOrderMoqBoxes();
    const unitsPerBox = typeof product.unitsPerBox === 'number' && product.unitsPerBox > 0 ? product.unitsPerBox : 1;
    const stockMoqUnits = stockMoqBoxes * unitsPerBox;
    const disclosure = checkPriceDisclosure(product, 'stock');
    types.push({
      type: 'stock',
      available: true,
      recommended: false,
      pricePerUnit: disclosure.prices.wholesale,
      moq: stockMoqUnits,
      moqBoxes: stockMoqBoxes,
      reason: `Wholesale pricing with minimum order quantity (MOQ: ${stockMoqBoxes} boxes).`,
    });
  }

  // Group — available when product has logistics metadata
  const hasLogistics = hasLogisticsMetadata(product);
  if (hasLogistics) {
    const disclosure = checkPriceDisclosure(product, 'group');
    const existingGroupOrders = ais02Result.activeOrders.map((go) => ({
      code: go.code,
      progress: `${go.totalBoxesFilled} boxes filled, ${go.remainingToTarget} surface(s) remaining`,
      daysLeft: undefined as number | undefined,
    }));

    types.push({
      type: 'group',
      available: true,
      recommended: ais02Result.activeOrders.length > 0,
      pricePerUnit: disclosure.prices.importPerSurface, // group order: import price per surface only
      reason: ais02Result.activeOrders.length > 0
        ? `${ais02Result.activeOrders.length} active group order(s) available for ${product.manufacturer}.`
        : 'Share a palette with other buyers for import pricing.',
      existingOrders: existingGroupOrders.length > 0 ? existingGroupOrders : undefined,
    });
  }

  // Import — available for all users when product has logistics (individuals get an advisory that it's best for businesses)
  if (hasLogistics) {
    const disclosure = checkPriceDisclosure(product, 'import');
    const existingImports = openImportOrders.map((io) => ({
      code: io.code,
      progress: `${io.paletteFill.boxesFilled}/${io.paletteFill.totalBoxCapacity} boxes filled`,
      daysLeft: io.daysRemaining,
    }));

    const isRetailer = sessionContext.userType === 'retailer';
    types.push({
      type: 'import',
      available: true,
      recommended: false,
      pricePerUnit: disclosure.prices.importPer2Boxes, // import order: import price per 2 boxes only
      reason: isRetailer
        ? 'Single-user palette import for restaurants and supermarkets.'
        : 'Single-user palette import. Best suited for supermarkets and business accounts; you can still create one as an individual.',
      existingOrders: existingImports.length > 0 ? existingImports : undefined,
    });
  }

  // If group is recommended (active orders exist) and regular is also available,
  // mark regular as not recommended to nudge toward group
  if (types.some((t) => t.type === 'group' && t.recommended)) {
    const regular = types.find((t) => t.type === 'regular');
    if (regular) regular.recommended = false;
  }

  const unitsPerBox = typeof product.unitsPerBox === 'number' && product.unitsPerBox > 0
    ? product.unitsPerBox
    : (typeof (product as any).metadata?.unitsPerBox === 'number' && (product as any).metadata.unitsPerBox > 0
      ? (product as any).metadata.unitsPerBox
      : undefined);

  return {
    productId: product.id,
    productName: product.name,
    productState: product.productState,
    manufacturer: product.manufacturer,
    types,
    unitsPerBox,
  };
}

// ── AIS-05: Dream List Activation Flow ──

interface DreamListAlternative {
  id: string;
  name: string;
  manufacturer?: string;
  matchReason: 'same_manufacturer' | 'similar_category';
}

interface DreamListResult {
  productId: string;
  productName: string;
  dreamStage: string;
  stageExplanation: string;
  canAddToWishlist: boolean;
  alternatives: DreamListAlternative[];
}

/** Known Dream List stages and their user-facing explanations. */
const DREAM_STAGE_EXPLANATIONS: Record<string, string> = {
  interest_gathering:
    'This product is in the interest-gathering stage. More people need to express interest before it can move forward.',
  supplier_negotiation:
    'Enough interest has been collected! We are currently negotiating with the supplier to bring this product in.',
  pending_import:
    'Supplier terms are agreed. The product is pending its first import shipment.',
  default:
    'This product is on the Dream List and is not yet available for purchase. Express your interest to help move it forward!',
};

/**
 * AIS-05 — Handle Dream List activation flow.
 *
 * For CATALOG_EXTENSION products:
 * 1. Explains the current Dream List stage and what's needed to progress
 * 2. Offers to add the product to the user's Dream List wishlist
 * 3. Suggests ACTIVE_IMPORTED alternatives (same manufacturer or similar category)
 *
 * @param product  The CATALOG_EXTENSION product the user is interacting with
 * @param catalogProducts  Available catalog products to search for alternatives
 */
export function handleDreamListProduct(
  product: ProductWithState,
  catalogProducts: ProductCard[],
): DreamListResult {
  // 1. Resolve stage explanation
  const stage = product.dreamStage ?? 'default';
  const stageExplanation =
    DREAM_STAGE_EXPLANATIONS[stage] ?? DREAM_STAGE_EXPLANATIONS['default'];

  // 2. Wishlist is always available for CATALOG_EXTENSION products
  const canAddToWishlist = product.productState === 'CATALOG_EXTENSION';

  // 3. Find ACTIVE_IMPORTED alternatives
  const alternatives: DreamListAlternative[] = [];
  const seen = new Set<string>();

  // Pre-compute the Dream List product's categories for matching
  const selfCard = catalogProducts.find((c) => c.id === product.id);
  const productCategories = new Set(
    (selfCard?.categories ?? []).map((c) => c.toLowerCase()),
  );

  for (const card of catalogProducts) {
    if (card.id === product.id) continue;
    if (card.productState !== 'ACTIVE_IMPORTED') continue;
    if (seen.has(card.id)) continue;

    // Same manufacturer match
    if (
      product.manufacturer &&
      card.manufacturer &&
      card.manufacturer.toLowerCase() === product.manufacturer.toLowerCase()
    ) {
      seen.add(card.id);
      alternatives.push({
        id: card.id,
        name: card.name,
        manufacturer: card.manufacturer,
        matchReason: 'same_manufacturer',
      });
      continue;
    }

    // Similar category match
    if (
      productCategories.size > 0 &&
      card.categories?.some((cat) => productCategories.has(cat.toLowerCase()))
    ) {
      seen.add(card.id);
      alternatives.push({
        id: card.id,
        name: card.name,
        manufacturer: card.manufacturer,
        matchReason: 'similar_category',
      });
    }
  }

  logInfo(
    `[InterventionGates] AIS-05 Dream List flow productId=${product.id} stage=${stage} alternatives=${alternatives.length}`,
    {},
  );

  return {
    productId: product.id,
    productName: product.name,
    dreamStage: stage,
    stageExplanation,
    canAddToWishlist,
    alternatives,
  };
}

// ── AIS-07: Culinary Cross-Selling ──

interface CulinaryRecommendation {
  product: ProductCard;
  reason: string;
}

interface CulinaryRecommendationResult {
  cookingContext: string;
  recommendations: CulinaryRecommendation[];
}

/**
 * Culinary keyword map — maps cooking contexts to product-related keywords.
 * Used for keyword matching against product names, categories, and descriptions.
 */
const CULINARY_KEYWORD_MAP: Record<string, string[]> = {
  pasta: ['pasta', 'sauce', 'tomato', 'olive oil', 'parmesan', 'cheese', 'basil', 'garlic', 'oregano'],
  bread: ['flour', 'yeast', 'bread', 'butter', 'olive oil', 'salt', 'sesame', 'sourdough'],
  pizza: ['pizza', 'flour', 'tomato', 'mozzarella', 'cheese', 'olive oil', 'basil', 'oregano', 'yeast'],
  salad: ['salad', 'olive oil', 'vinegar', 'lemon', 'dressing', 'tahini', 'herbs'],
  baking: ['flour', 'sugar', 'butter', 'vanilla', 'chocolate', 'cocoa', 'baking powder', 'eggs'],
  grilling: ['spice', 'marinade', 'sauce', 'olive oil', 'charcoal', 'seasoning', 'herbs'],
  sushi: ['rice', 'soy sauce', 'nori', 'wasabi', 'ginger', 'sesame', 'vinegar'],
  soup: ['broth', 'stock', 'lentil', 'bean', 'spice', 'herbs', 'cream', 'noodle'],
  stir_fry: ['soy sauce', 'sesame oil', 'rice', 'noodle', 'ginger', 'garlic', 'chili'],
  hummus: ['chickpea', 'tahini', 'lemon', 'garlic', 'olive oil', 'cumin', 'paprika'],
};

/**
 * Extract keywords from a cooking context string by matching against known
 * culinary contexts and extracting individual words.
 */
function extractCulinaryKeywords(cookingContext: string): string[] {
  const normalized = cookingContext.toLowerCase().trim();
  const keywords = new Set<string>();

  // Match against known culinary contexts
  for (const [context, contextKeywords] of Object.entries(CULINARY_KEYWORD_MAP)) {
    if (normalized.includes(context)) {
      for (const kw of contextKeywords) {
        keywords.add(kw);
      }
    }
  }

  // Also extract individual words from the cooking context as fallback keywords
  const words = normalized.split(/\s+/).filter((w) => w.length > 2);
  for (const word of words) {
    keywords.add(word);
  }

  return Array.from(keywords);
}

/**
 * Check if a product matches any of the given keywords by searching
 * its name, categories, and description.
 */
function productMatchesKeywords(
  product: ProductCard,
  keywords: string[],
): { matches: boolean; matchedKeyword?: string } {
  const searchableText = [
    product.name,
    ...(product.categories ?? []),
    product.shortDescription,
    product.description,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  for (const keyword of keywords) {
    if (searchableText.includes(keyword)) {
      return { matches: true, matchedKeyword: keyword };
    }
  }

  return { matches: false };
}

/**
 * AIS-07 — Generate culinary recommendations from the product catalog.
 *
 * When a user mentions a cooking context or recipe, this function finds
 * complementary products using keyword matching against product names,
 * categories, and descriptions. Only ACTIVE_IMPORTED products are returned
 * (Ground Truth enforcement).
 *
 * @param cookingContext  The cooking context string (e.g. "making pasta", "baking bread")
 * @param catalogProducts  Array of ProductCard from the catalog
 * @returns Structured result with recommended products and reasons
 */
export function getCulinaryRecommendations(
  cookingContext: string,
  catalogProducts: ProductCard[],
): CulinaryRecommendationResult {
  const keywords = extractCulinaryKeywords(cookingContext);

  if (keywords.length === 0) {
    logInfo(`[InterventionGates] AIS-07 no keywords extracted from context="${cookingContext}"`, {});
    return { cookingContext, recommendations: [] };
  }

  const recommendations: CulinaryRecommendation[] = [];
  const seen = new Set<string>();

  for (const product of catalogProducts) {
    // Ground Truth enforcement: only ACTIVE_IMPORTED products
    if (product.productState !== 'ACTIVE_IMPORTED') continue;
    if (seen.has(product.id)) continue;

    const { matches, matchedKeyword } = productMatchesKeywords(product, keywords);
    if (matches && matchedKeyword) {
      seen.add(product.id);
      recommendations.push({
        product,
        reason: `Complements your ${cookingContext} — matched on "${matchedKeyword}"`,
      });
    }
  }

  logInfo(
    `[InterventionGates] AIS-07 culinary recommendations context="${cookingContext}" keywords=${keywords.length} results=${recommendations.length}`,
    {},
  );

  return { cookingContext, recommendations };
}

// ── AIS-07: Post-Order Complementary Suggestions ──

interface PostOrderSuggestion {
  complementaryProducts: CulinaryRecommendation[];
  joinableGroupOrders: {
    code: string;
    manufacturer: string;
    progress: string;
  }[];
}

/**
 * AIS-07 — Generate post-order complementary suggestions.
 *
 * After order completion, suggests complementary items from the same
 * manufacturer or related categories, and surfaces open group orders
 * for the same manufacturers.
 *
 * @param purchasedProductIds  IDs of products the user just purchased
 * @param catalogProducts  Full catalog for finding complements
 * @returns Complementary product suggestions and joinable group orders
 */
export async function getPostOrderSuggestions(
  purchasedProductIds: string[],
  catalogProducts: ProductCard[],
): Promise<PostOrderSuggestion> {
  // Resolve purchased products from catalog
  const purchasedProducts = catalogProducts.filter((p) =>
    purchasedProductIds.includes(p.id),
  );

  if (purchasedProducts.length === 0) {
    return { complementaryProducts: [], joinableGroupOrders: [] };
  }

  // Collect manufacturers and categories from purchased products
  const manufacturers = new Set<string>();
  const categories = new Set<string>();
  const purchasedIds = new Set(purchasedProductIds);

  for (const product of purchasedProducts) {
    if (product.manufacturer) manufacturers.add(product.manufacturer.toLowerCase());
    for (const cat of product.categories ?? []) {
      categories.add(cat.toLowerCase());
    }
  }

  // Find complementary products: same manufacturer or related categories
  const complementaryProducts: CulinaryRecommendation[] = [];
  const seen = new Set<string>();

  for (const product of catalogProducts) {
    if (purchasedIds.has(product.id)) continue;
    if (product.productState !== 'ACTIVE_IMPORTED') continue;
    if (seen.has(product.id)) continue;

    // Same manufacturer match
    if (
      product.manufacturer &&
      manufacturers.has(product.manufacturer.toLowerCase())
    ) {
      seen.add(product.id);
      complementaryProducts.push({
        product,
        reason: `From the same manufacturer as your recent purchase`,
      });
      continue;
    }

    // Related category match
    if (product.categories?.some((cat) => categories.has(cat.toLowerCase()))) {
      seen.add(product.id);
      complementaryProducts.push({
        product,
        reason: `Related to categories in your recent order`,
      });
    }
  }

  // Find joinable group orders for the same manufacturers
  const joinableGroupOrders: PostOrderSuggestion['joinableGroupOrders'] = [];

  for (const manufacturer of manufacturers) {
    try {
      const groupOrders = await listDiscoverableGroupOrders({
        manufacturerId: manufacturer,
        limit: 3,
      });

      for (const go of groupOrders) {
        joinableGroupOrders.push({
          code: go.code,
          manufacturer: go.manufacturer ?? manufacturer,
          progress: `${go.totalBoxesFilled} boxes filled, ${go.remainingToTarget} surface(s) remaining`,
        });
      }
    } catch {
      // If group order lookup fails, continue without suggestions
      logInfo(`[InterventionGates] AIS-07 failed to fetch group orders for manufacturer="${manufacturer}"`, {});
    }
  }

  logInfo(
    `[InterventionGates] AIS-07 post-order suggestions purchased=${purchasedProductIds.length} complements=${complementaryProducts.length} groups=${joinableGroupOrders.length}`,
    {},
  );

  return { complementaryProducts, joinableGroupOrders };
}


// ── AIS-08: Cart Management — Minimum Order Validation ──

/**
 * Stock/wholesale order MOQ in boxes (minimum boxes to order).
 * Set via STOCK_ORDER_DEFAULT_MOQ_BOXES (default 3). Display and copy use "boxes".
 */
function getStockOrderMoqBoxes(): number {
  const raw = process.env.STOCK_ORDER_DEFAULT_MOQ_BOXES ?? process.env.STOCK_ORDER_DEFAULT_MOQ_UNITS ?? '3';
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 3;
}

/**
 * Stock order minimum quantity in units (for cart validation).
 * Uses STOCK_ORDER_DEFAULT_MOQ_UNITS when set; otherwise not used for global validation.
 */
function getStockOrderMoqUnits(): number {
  const raw = process.env.STOCK_ORDER_DEFAULT_MOQ_UNITS;
  if (raw == null || raw === '') return 0;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Minimum order thresholds per order type. Stock MOQ is in boxes (display). */
function getOrderTypeMinimums(): Record<string, { minQuantity: number; label: string }> {
  const stockMoqBoxes = getStockOrderMoqBoxes();
  const stockMoqUnits = getStockOrderMoqUnits();
  return {
    stock: {
      minQuantity: stockMoqUnits > 0 ? stockMoqUnits : stockMoqBoxes * 6,
      label: `Stock orders require a minimum of ${stockMoqBoxes} boxes (MOQ)`,
    },
    group: { minQuantity: 1, label: 'Group orders require at least 1 box' },
    import: { minQuantity: 1, label: 'Import orders require at least 1 box' },
  };
}

interface CartCheckoutShortfall {
  orderType: string;
  currentQuantity: number;
  requiredQuantity: number;
  shortfall: number;
  message: string;
  suggestedItems: { productId: string; name: string; suggestedQuantity: number }[];
}

export interface CartCheckoutResult {
  allowed: boolean;
  gate: 'AIS-08';
  shortfalls: CartCheckoutShortfall[];
  summary: string;
}

/**
 * AIS-08 — Validate cart checkout against minimum order requirements.
 *
 * Groups cart items by their order type, sums quantities per type, and checks
 * each against the minimum threshold. When a shortfall exists, suggests items
 * from the same order type group that the user could increase to meet the minimum.
 *
 * @param cart  The current cart snapshot
 * @param orderTypes  Map of productId → order type for each cart item
 * @returns Structured result indicating whether checkout is allowed and any shortfalls
 */
export function validateCartCheckout(
  cart: CartSnapshot,
  orderTypes: Record<string, 'regular' | 'stock' | 'group' | 'import'>,
): CartCheckoutResult {
  // Group cart items by order type
  const itemsByType = new Map<string, CartItemSnapshot[]>();

  for (const item of cart.items) {
    const type =
      (item.orderType != null
        ? (item.orderType === 'STOCK' ? 'stock' : 'regular')
        : orderTypes[item.productId]) ?? 'regular';
    const existing = itemsByType.get(type) ?? [];
    existing.push(item);
    itemsByType.set(type, existing);
  }

  const shortfalls: CartCheckoutShortfall[] = [];
  const orderTypeMinimums = getOrderTypeMinimums();

  for (const [orderType, items] of itemsByType) {
    const minimum = orderTypeMinimums[orderType];
    if (!minimum) continue; // regular has no minimum

    const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);

    if (totalQuantity < minimum.minQuantity) {
      const deficit = minimum.minQuantity - totalQuantity;

      // Suggest increasing quantity on existing items in this order type
      const suggestedItems = items.map((item) => ({
        productId: item.productId,
        name: item.name,
        suggestedQuantity: item.quantity + Math.ceil(deficit / items.length),
      }));

      const unitWord = orderType === 'stock' ? 'unit(s)' : 'unit(s)';
      shortfalls.push({
        orderType,
        currentQuantity: totalQuantity,
        requiredQuantity: minimum.minQuantity,
        shortfall: deficit,
        message: `${minimum.label}. You currently have ${totalQuantity} ${unitWord} — add ${deficit} more to proceed.`,
        suggestedItems,
      });
    }
  }

  const allowed = shortfalls.length === 0;
  const summary = allowed
    ? 'Cart meets all minimum order requirements. Ready for checkout.'
    : `${shortfalls.length} order type(s) do not meet minimum requirements.`;

  logInfo(
    `[InterventionGates] AIS-08 cart validation items=${cart.items.length} allowed=${allowed} shortfalls=${shortfalls.length}`,
    {},
  );

  return { allowed, gate: 'AIS-08', shortfalls, summary };
}

// ── Exported gate functions for use by tool executor ──

export { checkPriceDisclosure, evaluateProductState, evaluateSuboptimalPath };
export type { ProductWithState, PriceDisclosureResult, ActiveGroupOrderInfo, DreamListResult, DreamListAlternative, CulinaryRecommendation, CulinaryRecommendationResult, PostOrderSuggestion, CartCheckoutShortfall };

/**
 * Resolve a WooProduct into a ProductWithState for external callers.
 */
export { resolveProductState };
