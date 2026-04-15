import type { WooProduct } from '../woocommerce/types';
import { logError, logInfo } from '../../logger';

const HUBSPOT_US_BASE = 'https://api.hubapi.com';
const HUBSPOT_EU_BASE = 'https://api-eu1.hubapi.com';

interface HubSpotProductRecord {
  id: string;
  properties?: Record<string, string | null | undefined>;
}

let cachedProductPropertyNames: Set<string> | null = null;

interface DescriptionPropertyNames {
  short: string[];
  detailed: string[];
}
let cachedDescriptionProps: DescriptionPropertyNames | null = null;

function getProductToken(): string | null {
  const token = process.env.HUBSPOT_PRODUCTS_ACCESS_TOKEN || process.env.HUBSPOT_ACCESS_TOKEN;
  return token ?? null;
}

export function hasHubSpotProductSourceConfigured(): boolean {
  return !!getProductToken();
}

function getBaseUrl(token: string): string {
  const envUrl = process.env.HUBSPOT_BASE_URL?.trim();
  if (envUrl) return envUrl.replace(/\/$/, '');
  if (token.startsWith('pat-eu1-') || token.startsWith('eu1-')) return HUBSPOT_EU_BASE;
  return HUBSPOT_US_BASE;
}

function toPositiveInt(value: unknown): number | undefined {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return undefined;
  return Math.floor(num);
}

function firstNonEmpty(values: unknown[]): string | undefined {
  for (const value of values) {
    if (value == null) continue;
    const s = String(value).trim();
    if (s) return s;
  }
  return undefined;
}

function normalizeDisplayName(name: string | undefined): string | undefined {
  if (!name) return name;
  // HubSpot imports sometimes append Woo store ID like "Product Name (#339)".
  // Keep clean user-facing names while preserving real product IDs elsewhere.
  return name.replace(/\s*\(#\d+\)\s*$/u, '').trim();
}

function parseCommaList(raw: string | undefined): { id: number; name: string }[] {
  if (!raw) return [];
  const items = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return items.map((name, idx) => ({ id: idx + 1, name }));
}

/** Labels/names for short description (Hebrew + English) */
const SHORT_DESC_MATCHERS = [
  'תיאור קצר',
  'short description',
  'short_description',
  'shortdescription',
  'short_desc'
];

/** Labels/names for detailed description (Hebrew + English) */
const DETAILED_DESC_MATCHERS = [
  'תיאור מפורט',
  'detailed description',
  'detailed_description',
  'detaileddescription',
  'detailed_desc',
  'full_description',
  'long_description'
];

function normalizeLabelForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/-/g, ' ')
    .replace(/_/g, ' ')
    .trim();
}

function matchesAny(matchers: string[], labelOrName: string): boolean {
  const normalized = normalizeLabelForMatch(labelOrName);
  return matchers.some((m) => {
    const mn = normalizeLabelForMatch(m);
    return normalized === mn || normalized.includes(mn) || mn.includes(normalized);
  });
}

async function getDescriptionPropertyNames(): Promise<DescriptionPropertyNames> {
  if (cachedDescriptionProps) return cachedDescriptionProps;
  const short: string[] = [];
  const detailed: string[] = [];
  try {
    const response = await hubspotRequest<{
      results?: Array<{ name?: string; label?: string }>;
    }>('/crm/v3/properties/products');
    const props = response.results ?? [];
    for (const p of props) {
      const name = (p.name ?? '').trim();
      const label = (p.label ?? '').trim();
      if (!name) continue;
      const labelOrName = label || name;
      if (matchesAny(SHORT_DESC_MATCHERS, labelOrName)) short.push(name);
      if (matchesAny(DETAILED_DESC_MATCHERS, labelOrName)) detailed.push(name);
    }
    // Fallback to common English internal names when no label match
    if (short.length === 0) short.push('short_description', 'shortdescription', 'short_desc');
    if (detailed.length === 0) detailed.push('detailed_description', 'full_description', 'long_description', 'description');
    cachedDescriptionProps = { short, detailed };
    logInfo('HubSpot description properties resolved', { short, detailed });
  } catch (err) {
    logError('HubSpot description properties lookup failed', err);
    cachedDescriptionProps = {
      short: ['short_description', 'shortdescription', 'short_desc'],
      detailed: ['detailed_description', 'full_description', 'long_description', 'description']
    };
  }
  return cachedDescriptionProps;
}

function parseHubSpotImageUrl(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const s = raw.trim();
  // hs_images returns a JSON array: [{"url":"https://...","type":"..."}]
  if (s.startsWith('[')) {
    try {
      const arr = JSON.parse(s) as Array<{ url?: string }>;
      const first = arr[0]?.url;
      if (first) return first.trim();
    } catch {
      // fall through to plain URL
    }
  }
  // Plain URL or single JSON object
  if (s.startsWith('{')) {
    try {
      const obj = JSON.parse(s) as { url?: string };
      if (obj.url) return obj.url.trim();
    } catch {
      // fall through
    }
  }
  return s || undefined;
}

function getFirstFromProps(p: Record<string, string | null | undefined>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = p[k];
    if (v != null) {
      const s = String(v).trim();
      if (s) return s;
    }
  }
  return undefined;
}

/** Words we do not require in product text when doing similar search (e.g. "tasty yellow sauce" → match on yellow + sauce only). */
const SEARCH_STOP_WORDS = new Set([
  'a', 'an', 'the', 'to', 'for', 'and', 'or', 'but', 'in', 'on', 'at', 'by', 'with',
  'i', 'want', 'wanna', 'buy', 'get', 'need', 'like', 'some', 'any', 'something',
  'tasty', 'good', 'nice', 'great', 'delicious', 'yummy', 'yum', 'best', 'really',
  'please', 'maybe', 'just', 'very', 'so', 'is', 'it', 'me', 'my', 'have', 'has'
]);

/** Common English → Hebrew (and vice versa) for product search. "sauce" includes רוטב and מחית (puree/paste) so "yellow sauce" matches מחית עגבניות צהובות. */
const SEARCH_TERM_EQUIVALENTS: Record<string, string[]> = {
  yellow: ['צהוב', 'צהובות', 'yellow'],
  sauce: ['רוטב', 'מחית', 'sauce'], // מחית = puree/paste, used like sauce (e.g. מחית עגבניות צהובות)
  red: ['אדום', 'red'],
  green: ['ירוק', 'green'],
  pesto: ['פסטו', 'pesto'],
  tomato: ['עגבניה', 'עגבניות', 'tomato'],
  basil: ['בזיליקום', 'basil'],
  olive: ['זית', 'זיתים', 'olive'],
  oil: ['שמן', 'oil'],
  pasta: ['פסטה', 'pasta'],
  spread: ['ממרח', 'spread'],
  cheese: ['גבינה', 'גבינות', 'cheese'],
  spicy: ['חריף', 'חריפה', 'spicy'],
  hot: ['חריף', 'hot'],
  sweet: ['מתוק', 'מתוקה', 'sweet'],
  flavorful: ['עם טעם', 'טעים'],
  // Origin / country (for multi-property search)
  italian: ['איטליה', 'איטלקי', 'italian', 'italy'],
  italy: ['איטליה', 'italy'],
  israel: ['ישראל', 'israel'],
  france: ['צרפת', 'france'],
  spain: ['ספרד', 'spain'],
  greece: ['יוון', 'greece'],
};

function getSearchTermVariants(term: string): string[] {
  const t = term.trim().toLowerCase();
  if (!t) return [];
  const equiv = SEARCH_TERM_EQUIVALENTS[t];
  if (equiv) return [...new Set(equiv)];
  return [term.trim()];
}

/** True if string contains Hebrew characters. */
function hasHebrew(s: string): boolean {
  return /[\u0590-\u05FF]/.test(s);
}

/** Prefer Hebrew variant for HubSpot search. HubSpot product properties (name, description, etc.) are in Hebrew. */
function toHebrewSearchTerm(term: string): string {
  const variants = getSearchTermVariants(term);
  const hebrew = variants.find(hasHebrew);
  return (hebrew || variants[0] || term).trim();
}

/** Translate user query to Hebrew for HubSpot search. User asks in English → we translate → search HubSpot (properties are in Hebrew). E.g. "yellow sauce" → "צהוב רוטב". */
function toHebrewSearchQuery(query: string): string {
  const terms = query.trim().split(/\s+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  const hebrewTerms = terms.map(toHebrewSearchTerm);
  return hebrewTerms.join(' ');
}

/** Strip HTML tags to get plain text for search. */
function stripHtml(html: string | null | undefined): string {
  if (html == null) return '';
  return String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Combined searchable text from all HubSpot text properties: name, descriptions, producer (tywr_yzrn). */
function productSearchableText(p: WooProduct): string {
  const parts = [
    p.name ?? '',
    p.shortDescription ?? '',
    p.detailedDescription ?? '',
    p.description ?? '',
    (p.metadata && typeof p.metadata.producerDescription === 'string') ? p.metadata.producerDescription : ''
  ].map((s) => stripHtml(s));
  return parts.join(' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Terms that must appear in product text; skip stop words (e.g. "tasty", "buy") so "tasty yellow sauce" matches on yellow + sauce. */
function contentTermsForSimilarSearch(terms: string[]): string[] {
  const content = terms
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t && !SEARCH_STOP_WORDS.has(t));
  return content.length > 0 ? content : terms;
}

/** Terms that describe product type (what the product IS). For these we require match in product name so "pasta" does not return pesto spread (which only mentions pasta in description). */
const PRODUCT_TYPE_TERMS = new Set([
  'pasta', 'sauce', 'spread', 'pesto', 'oil', 'cheese', 'tomato', 'paste', 'puree',
  'פסטה', 'רוטב', 'ממרח', 'פסטו', 'שמן', 'גבינה', 'עגבניה', 'מחית'
]);

/** When there is no exact match for a product type, recommend these related terms (e.g. for "pasta" → sauces/spreads that go with pasta). */
const RELATED_TERMS_FOR_PRODUCT_TYPE: Record<string, { terms: string[]; reasonEn: string; reasonHe: string }> = {
  pasta: {
    terms: ['פסטו', 'רוטב', 'ממרח', 'pesto', 'sauce', 'spread'],
    reasonEn: 'No pasta in the catalog; showing sauces and spreads that go well with pasta.',
    reasonHe: 'אין פסטה בקטלוג; הנה רטבים וממרחים שמתאימים לפסטה.',
  },
  sauce: {
    terms: ['ממרח', 'רוטב', 'מחית', 'spread', 'paste', 'puree'],
    reasonEn: 'No sauce matching your request; showing related spreads and purees.',
    reasonHe: 'אין רוטב שמתאים; הנה ממרחים ומחיות דומים.',
  },
  pesto: {
    terms: ['רוטב', 'ממרח', 'sauce', 'spread'],
    reasonEn: 'No pesto matching; showing related sauces and spreads.',
    reasonHe: 'אין פסטו שמתאים; הנה רטבים וממרחים דומים.',
  },
};

/** True if product NAME only contains the term or its variant. Used for product-type queries so "pasta" returns only products that ARE pasta (name contains פסטה/pasta), not sauces "for pasta" or in category "pasta sauces". */
function productNameContainsTerm(product: WooProduct, term: string): boolean {
  const nameOnly = (product.name ?? '').toLowerCase();
  const variants = getSearchTermVariants(term);
  return variants.some((v) => v && nameOnly.includes(v.toLowerCase()));
}

/** True if product name/description contains every term (or its Hebrew/English equivalent). */
function productContainsAllTerms(product: WooProduct, terms: string[]): boolean {
  const text = productSearchableText(product);
  for (const term of terms) {
    const variants = getSearchTermVariants(term);
    const found = variants.some((v) => v && text.includes(v.toLowerCase()));
    if (!found) return false;
  }
  return true;
}

/** Count how many of the given terms (or their variants) appear in the product text. Used to rank by "matching properties". */
function productMatchScore(product: WooProduct, terms: string[]): number {
  const text = productSearchableText(product);
  let score = 0;
  for (const term of terms) {
    const variants = getSearchTermVariants(term);
    if (variants.some((v) => v && text.includes(v.toLowerCase()))) score += 1;
  }
  return score;
}

/** HubSpot product property names (as in HubSpot CRM). Include all text fields used for search. */
const PRODUCT_PROPERTIES = [
  'name',
  'description',
  'hs_rich_text_description',
  'short_description',
  'detailed_description',
  'tywr_yzrn', // producer/origin rich text (Hebrew)
  'hs_sku',
  'hs_images',
  'hs_cost_of_goods_sold',
  'hs_status',
  'price',
  'mhyr_qmwny_lyhydh_retail_unit_price',
  'n2_mhyr_ybwn_qbwzty_group_import_pricing__per_carton',
  'n3_mhyr_sytwny_wholesale_pricing__per_carton',
  'n4_mhyr_ybwn_lmsth_ml_full_pallet_import_pricing',
  'yzrn__spq_producer__supplier',
  'manufacturer_name',
  'manufacturer',
  'mwtg_brand',
  'rz_mqwr_country_of_origin',
  'mspr_yhydwt_bqrtwn',
  'mspr_qrtwnym_bskbh',
  'mspr_qrtwnym_bmsth',
  'store_product_id',
  'product_source_store',
  'barcode',
  'ean',
  'ean13',
  'weight',
  'category',
  'categories',
  'in_stock',
  'stock_status',
  'inventory',
  'stock_quantity',
  'url',
  'product_url',
  'sale_price',
  'is_downloadable',
  'download_link',
  'sub_category',
  'tags'
];

function mapHubSpotToWooProduct(
  raw: HubSpotProductRecord,
  descriptionProps?: { short: string[]; detailed: string[] }
): WooProduct {
  const p = raw.properties ?? {};

  // Product ID: always use HubSpot's native object ID as the canonical identifier
  const productId = raw.id;

  // SKU from hs_sku
  const sku = firstNonEmpty([p.hs_sku, p.sku]);

  // Manufacturer (יצרן / ספק) — primary from yzrn__spq_producer__supplier
  const manufacturer = firstNonEmpty([
    p.yzrn__spq_producer__supplier,
    p.manufacturer_name,
    p.manufacturer
  ]);

  // Brand (מותג) — from mwtg_brand
  const brand = firstNonEmpty([p.mwtg_brand, p.brand]);

  // Country of origin (ארץ מקור)
  const countryOfOrigin = firstNonEmpty([p.rz_mqwr_country_of_origin]);

  // Logistics fields
  const unitsPerBox = toPositiveInt(
    firstNonEmpty([p.mspr_yhydwt_bqrtwn, p.units_per_box, p.units_in_box, p.units_per_carton])
  );
  const boxesPerLayer = toPositiveInt(
    firstNonEmpty([p.mspr_qrtwnym_bskbh, p.boxes_per_layer, p.cartons_per_layer])
  );
  const layersPerSurface = toPositiveInt(
    firstNonEmpty([p.mspr_qrtwnym_bmsth, p.layers_per_surface, p.layers_per_pallet])
  );
  let boxesPerSurface = toPositiveInt(
    firstNonEmpty([p.boxes_per_surface, p.boxes_per_pallet])
  );
  if (!boxesPerSurface && boxesPerLayer && layersPerSurface) {
    boxesPerSurface = boxesPerLayer * layersPerSurface;
  }

  // Pricing — use HubSpot's actual field names directly
  // n2 = group import pricing (per carton) → used for group order type (importPricePerSurface)
  // n4 = full pallet import pricing → used for import order type (importPricePer2Boxes)
  const costPrice = firstNonEmpty([p.hs_cost_of_goods_sold, p.cost_price, p.cost]);
  const importPricePerSurface = firstNonEmpty([p.n2_mhyr_ybwn_qbwzty_group_import_pricing__per_carton]);
  const importPricePer2Boxes = firstNonEmpty([p.n4_mhyr_ybwn_lmsth_ml_full_pallet_import_pricing]);
  const wholesalePrice = firstNonEmpty([p.n3_mhyr_sytwny_wholesale_pricing__per_carton]);
  const retailPrice = firstNonEmpty([p.mhyr_qmwny_lyhydh_retail_unit_price, p.price]);
  const salePrice = firstNonEmpty([p.sale_price, p.on_sale_price]);

  // Image — use hs_images (HubSpot's image field, may be JSON array)
  const imageUrl = parseHubSpotImageUrl(p.hs_images) ?? firstNonEmpty([p.image_url, p.product_image_url]);

  const barcode = firstNonEmpty([p.barcode, p.ean, p.ean13, p.upc, p.gtin]);
  const status = firstNonEmpty([p.hs_status, p.status]);
  const statusLower = status?.toLowerCase();
  // Use only hs_status for purchasable and inStock: active (or missing) = purchasable and in stock; inactive/draft/archived = not.
  const notPurchasableByStatus = statusLower && ['inactive', 'draft', 'archived', 'deleted'].includes(statusLower);
  const isDownloadableRaw = firstNonEmpty([p.is_downloadable, p.downloadable]);
  const isDownloadable = isDownloadableRaw != null
    ? ['1', 'true', 'yes'].includes(isDownloadableRaw.toLowerCase())
    : false;
  const downloadLink = firstNonEmpty([p.download_link, p.download_url]);
  const subCategory = firstNonEmpty([p.sub_category, p.subcategory]);
  const tagsRaw = firstNonEmpty([p.tags]);
  const tags = tagsRaw ? tagsRaw.split(',').map((t: string) => t.trim()).filter(Boolean) : undefined;
  const inventoryRaw = firstNonEmpty([p.inventory, p.stock_quantity]);
  const inventory = inventoryRaw != null ? parseInt(inventoryRaw, 10) || undefined : undefined;

  const permalink = firstNonEmpty([p.url, p.product_url]);

  // Descriptions
  // shortDescription = plain text description (used in card preview)
  // detailedDescription = hs_rich_text_description (used in modal, may contain HTML)
  // We always prefer the explicit HubSpot fields directly, then fall back to dynamic lookup
  const shortDescription: string | undefined =
    firstNonEmpty([p.description]) ??
    (descriptionProps ? getFirstFromProps(p, descriptionProps.short) : undefined) ??
    firstNonEmpty([p.short_description]);

  const detailedDescription: string | undefined =
    firstNonEmpty([p.hs_rich_text_description]) ??
    firstNonEmpty([p.detailed_description]) ??
    (descriptionProps ? getFirstFromProps(p, descriptionProps.detailed) : undefined) ??
    shortDescription;

  const description = shortDescription ?? detailedDescription;

  // Producer/origin rich text (tywr_yzrn) — include in searchable text
  const producerRichText = firstNonEmpty([p.tywr_yzrn]);
  const producerDescription = producerRichText ? stripHtml(producerRichText) : undefined;

  // inStock = same as purchasable: only hs_status matters. No in_stock/stock_status — avoid blocking active products.
  const inStock: boolean = !notPurchasableByStatus;

  return {
    id: productId,
    name: normalizeDisplayName(firstNonEmpty([p.name])) ?? `HubSpot Product ${raw.id}`,
    price: retailPrice,
    permalink,
    description,
    shortDescription,
    detailedDescription,
    images: imageUrl ? [{ src: imageUrl }] : [],
    categories: parseCommaList(firstNonEmpty([p.categories, p.category])),
    subCategory,
    type: 'simple',
    inStock,
    inventory,
    purchasable: !notPurchasableByStatus,
    weight: firstNonEmpty([p.weight]),
    sku,
    barcode: barcode ?? sku,
    costPrice,
    importPricePerSurface,
    importPricePer2Boxes,
    wholesalePrice,
    retailPrice,
    salePrice,
    status,
    isDownloadable,
    downloadLink,
    manufacturer,
    brand,
    countryOfOrigin,
    tags,
    unitsPerBox,
    layersPerSurface,
    boxesPerSurface,
    boxesPerLayer,
    metadata: {
      source: 'hubspot',
      hubspotProductId: raw.id,
      producerDescription,
      sku,
      barcode: barcode ?? sku,
      costPrice,
      importPricePerSurface,
      importPricePer2Boxes,
      wholesalePrice,
      salePrice,
      unitsPerBox,
      layersPerSurface,
      boxesPerSurface,
      manufacturer,
      brand,
      countryOfOrigin,
      boxesPerLayer
    }
  };
}

async function hubspotRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getProductToken();
  if (!token) throw new Error('HubSpot product token missing');

  const baseUrl = getBaseUrl(token);
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {})
    }
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HubSpot products API ${res.status}: ${text}`);
  }

  return (await res.json()) as T;
}

async function getProductPropertyNames(): Promise<Set<string>> {
  if (cachedProductPropertyNames) return cachedProductPropertyNames;
  try {
    const response = await hubspotRequest<{ results?: Array<{ name?: string }> }>(
      '/crm/v3/properties/products'
    );
    const names = new Set(
      (response.results ?? [])
        .map((p) => (p.name ?? '').trim())
        .filter(Boolean)
    );
    cachedProductPropertyNames = names;
    return names;
  } catch (err) {
    logError('HubSpot product properties lookup failed', err);
    cachedProductPropertyNames = new Set();
    return cachedProductPropertyNames;
  }
}

/** Fetch products by HubSpot query (exact search only). Used for similar-search by term. */
async function fetchHubSpotProductsByQuery(
  trimmed: string,
  desired: number,
  descriptionProps: DescriptionPropertyNames,
  propsStr: string
): Promise<WooProduct[]> {
  let results: HubSpotProductRecord[] = [];
  const allPropsArr = propsStr.split(',');

  if (!trimmed) {
    let after: string | undefined;
    while (results.length < desired) {
      const pageLimit = Math.min(100, desired - results.length);
      const response = await hubspotRequest<{
        results?: HubSpotProductRecord[];
        paging?: { next?: { after?: string } };
      }>(
        `/crm/v3/objects/products?limit=${pageLimit}&properties=${encodeURIComponent(propsStr)}${after ? `&after=${encodeURIComponent(after)}` : ''}`
      );
      const pageItems = response.results ?? [];
      results.push(...pageItems);
      after = response.paging?.next?.after;
      if (!after || pageItems.length === 0) break;
    }
  } else {
    let after: string | undefined;
    while (results.length < desired) {
      const pageLimit = Math.min(100, desired - results.length);
      const response = await hubspotRequest<{
        results?: HubSpotProductRecord[];
        paging?: { next?: { after?: string } };
      }>('/crm/v3/objects/products/search', {
        method: 'POST',
        body: JSON.stringify({
          query: trimmed,
          limit: pageLimit,
          after,
          properties: allPropsArr
        })
      });
      const pageItems = response.results ?? [];
      results.push(...pageItems);
      after = response.paging?.next?.after;
      if (!after || pageItems.length === 0) break;
    }
  }

  const mapped = results.map((r) => mapHubSpotToWooProduct(r, descriptionProps));
  return mapped.filter((p) => {
    const hasManufacturer = !!p.manufacturer;
    const hasLogistics = !!p.unitsPerBox || !!p.boxesPerLayer || !!p.layersPerSurface;
    return hasManufacturer || hasLogistics;
  });
}

/**
 * Search HubSpot products. User may ask in English (e.g. "yellow sauce"); we translate to Hebrew first,
 * then search HubSpot — product properties (name, description, short/detailed description) are in Hebrew.
 */
export type HubSpotSearchResult = {
  products: WooProduct[];
  matchType: 'exact' | 'related';
  reason?: string;
};

/** Normalize manufacturer for comparison: trim, lowercase (ASCII), collapse spaces. */
function normalizeManufacturerForMatch(s: string | undefined | null): string {
  if (s == null) return '';
  return String(s)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/['']/g, "'");
}

/** Known manufacturer aliases: Latin/English name -> possible values in HubSpot (e.g. Hebrew). */
const MANUFACTURER_ALIASES: Record<string, string[]> = {
  "campo d'oro srl": ['קאמפו דאורו אס.אר.אל', "campo d'oro", "campo d'oro srl", 'campo doro'],
  "campo d'oro": ['קאמפו דאורו אס.אר.אל', "campo d'oro srl", 'campo doro'],
};

/** Extract significant tokens (length >= 2, skip common legal suffixes). */
function manufacturerTokens(s: string): string[] {
  const normalized = normalizeManufacturerForMatch(s);
  const skip = new Set(['srl', 'ltd', 'inc', 'llc', 'co', 'corp', 'plc', 'גmbh']);
  return normalized
    .split(/[\s.,\-_]+/)
    .map((t) => t.replace(/['']/g, "'").trim())
    .filter((t) => t.length >= 2 && !skip.has(t));
}

/** True if product's manufacturer matches the requested manufacturer (flexible contains, token overlap, or known alias). */
function manufacturerMatches(productManufacturer: string | undefined | null, requestedManufacturer: string): boolean {
  const a = normalizeManufacturerForMatch(productManufacturer);
  const b = normalizeManufacturerForMatch(requestedManufacturer);
  if (!a || !b) return false;
  if (a.includes(b) || b.includes(a)) return true;
  // Alias: e.g. request "Campo D'oro Srl" matches product "קאמפו דאורו אס.אר.אל"
  const aliases = MANUFACTURER_ALIASES[b];
  if (aliases?.some((al) => normalizeManufacturerForMatch(al) === a || a.includes(normalizeManufacturerForMatch(al)))) return true;
  // Token overlap: at least 2 request tokens appear in product (or 1 token of length >= 4)
  const reqTokens = manufacturerTokens(requestedManufacturer);
  const productNorm = a;
  const matchCount = reqTokens.filter((t) => productNorm.includes(t) || productNorm.includes(t.replace(/'/g, ''))).length;
  if (matchCount >= 2) return true;
  if (matchCount >= 1 && reqTokens.some((t) => t.length >= 4)) return true;
  return false;
}

export type SearchHubSpotProductsOptions = {
  /** Only return products from this manufacturer (post-filter on mapped manufacturer). */
  manufacturer?: string;
};

export async function searchHubSpotProducts(
  query: string,
  limit: number,
  options?: SearchHubSpotProductsOptions
): Promise<HubSpotSearchResult> {
  const token = getProductToken();
  const emptyExact: HubSpotSearchResult = { products: [], matchType: 'exact' };
  if (!token) return emptyExact;

  const manufacturerFilter = options?.manufacturer?.trim();

  try {
    const descriptionProps = await getDescriptionPropertyNames();
    const allProps = [...new Set([...PRODUCT_PROPERTIES, ...descriptionProps.short, ...descriptionProps.detailed])];
    const propsStr = allProps.join(',');

    const trimmed = query.trim();
    const maxFetch = Number(process.env.HUBSPOT_PRODUCTS_MAX_FETCH ?? '500');
    const normalizedLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 200;
    const desired = Math.max(
      1,
      Math.min(normalizedLimit, Number.isFinite(maxFetch) && maxFetch > 0 ? Math.floor(maxFetch) : 500)
    );
    // When filtering by manufacturer, fetch more so we have enough after filtering
    const fetchLimit = manufacturerFilter ? Math.min(maxFetch || 500, Math.max(desired, 300)) : desired;

    // Step 1: Translate user query (English) to Hebrew, then search HubSpot (properties are in Hebrew).
    // When filtering by manufacturer and no query, search by manufacturer name so we get candidates to post-filter.
    const searchQuery = manufacturerFilter && !trimmed ? manufacturerFilter : trimmed;
    const hubspotQuery = toHebrewSearchQuery(searchQuery) || searchQuery;
    let filtered = await fetchHubSpotProductsByQuery(hubspotQuery, fetchLimit, descriptionProps, propsStr);

    if (manufacturerFilter && filtered.length > 0) {
      const beforeCount = filtered.length;
      filtered = filtered.filter((p) => manufacturerMatches(p.manufacturer, manufacturerFilter));
      logInfo('HubSpot product search: manufacturer filter applied', {
        manufacturer: manufacturerFilter,
        before: beforeCount,
        after: filtered.length,
      });
    }
    // When filtering by manufacturer and search-by-name returned none, try broad fetch and filter (e.g. manufacturer stored in Hebrew)
    if (manufacturerFilter && filtered.length === 0 && searchQuery === manufacturerFilter) {
      const broad = await fetchHubSpotProductsByQuery('', fetchLimit, descriptionProps, propsStr);
      filtered = broad.filter((p) => manufacturerMatches(p.manufacturer, manufacturerFilter));
      const uniqueManufacturers = [...new Set(broad.map((p) => p.manufacturer || '').filter(Boolean))].slice(0, 20);
      logInfo('HubSpot product search: manufacturer filter (broad fetch)', {
        manufacturer: manufacturerFilter,
        after: filtered.length,
        broadCount: broad.length,
        sampleManufacturersInCatalog: uniqueManufacturers,
      });
    }

    // Post-filter: HubSpot may fuzzy-match (e.g. פסטה "pasta" → פסטו "pesto"). Keep only products that actually match. For product-type terms (pasta, sauce, etc.) require match in product name so we don't return "sauce for pasta" when user asked for "pasta".
    if (trimmed && filtered.length > 0) {
      const terms = trimmed.split(/\s+/).map((s) => s.trim()).filter(Boolean);
      const contentTerms = contentTermsForSimilarSearch(terms);
      if (contentTerms.length > 0) {
        const isSingleProductType =
          contentTerms.length === 1 && PRODUCT_TYPE_TERMS.has(contentTerms[0].toLowerCase());
        const mustMatch = isSingleProductType
          ? filtered.filter((p) => productNameContainsTerm(p, contentTerms[0]))
          : filtered.filter((p) => productContainsAllTerms(p, contentTerms));
        if (mustMatch.length > 0) filtered = mustMatch;
      }
    }

    if (filtered.length > 0) {
      const slice = filtered.slice(0, desired);
      logInfo('HubSpot product search success', { query, requestedLimit: desired, returned: slice.length });
      return { products: slice, matchType: 'exact' };
    }

    // Step 2 (similar search): Fetch by each property/term (color, origin, type, etc.), gather candidates, then filter and rank by how many properties match.
    if (trimmed) {
      const terms = trimmed.split(/\s+/).map((s) => s.trim()).filter(Boolean);
      const contentTerms = contentTermsForSimilarSearch(terms);
      if (contentTerms.length === 0) {
        logInfo('HubSpot product search: no results', { query });
        return emptyExact;
      }
      const similarFetchLimit = Math.min(300, maxFetch);
      const seenIds = new Set<string>();
      const allCandidates: WooProduct[] = [];
      const hebrewSearchTerms = [...new Set(
        contentTerms.flatMap((t) => getSearchTermVariants(t).filter(hasHebrew)).filter(Boolean)
      )];
      for (const searchTerm of hebrewSearchTerms) {
        const batch = await fetchHubSpotProductsByQuery(searchTerm, similarFetchLimit, descriptionProps, propsStr);
        for (const p of batch) {
          if (!seenIds.has(p.id)) {
            seenIds.add(p.id);
            allCandidates.push(p);
          }
        }
      }
      const isSingleProductType =
        contentTerms.length === 1 && PRODUCT_TYPE_TERMS.has(contentTerms[0].toLowerCase());
      const productTypeTerm = contentTerms.find((t) => PRODUCT_TYPE_TERMS.has(t.toLowerCase()));
      let similar: WooProduct[];
      if (contentTerms.length >= 2 && productTypeTerm) {
        // Multi-property with product type (e.g. "red Italian pasta"): first keep only products whose NAME contains the product type, then rank by other attributes (color, origin, etc.) in description.
        const nameMatches = allCandidates.filter((p) => productNameContainsTerm(p, productTypeTerm));
        const withScore = (nameMatches.length > 0 ? nameMatches : allCandidates)
          .map((p) => ({ p, score: productMatchScore(p, contentTerms) }))
          .filter((x) => x.score >= 1)
          .sort((a, b) => b.score - a.score);
        similar = withScore.map((x) => x.p);
      } else if (contentTerms.length >= 2) {
        // Multi-property, no product type: rank by number of matching properties.
        const withScore = allCandidates
          .map((p) => ({ p, score: productMatchScore(p, contentTerms) }))
          .filter((x) => x.score >= 1)
          .sort((a, b) => b.score - a.score);
        similar = withScore.map((x) => x.p);
      } else if (isSingleProductType) {
        similar = allCandidates.filter((p) => productNameContainsTerm(p, contentTerms[0]));
      } else {
        similar = allCandidates.filter((p) => productContainsAllTerms(p, contentTerms));
      }
      if (similar.length > 0) {
        logInfo('HubSpot similar search matched', { query: trimmed, contentTerms, matchCount: similar.length });
        return { products: similar.slice(0, normalizedLimit), matchType: 'exact' };
      }

      // Step 3 (related fallback): No exact match. For single product-type queries (e.g. "pasta"), recommend related products (sauces, spreads) with a reason.
      const relatedConfig = isSingleProductType ? RELATED_TERMS_FOR_PRODUCT_TYPE[contentTerms[0].toLowerCase()] : undefined;
      if (relatedConfig) {
        const relatedFetchLimit = Math.min(100, maxFetch);
        const seenIds = new Set<string>();
        const relatedCandidates: WooProduct[] = [];
        const hebrewRelated = relatedConfig.terms.filter(hasHebrew);
        for (const searchTerm of hebrewRelated) {
          const batch = await fetchHubSpotProductsByQuery(searchTerm, relatedFetchLimit, descriptionProps, propsStr);
          for (const p of batch) {
            if (!seenIds.has(p.id)) {
              seenIds.add(p.id);
              relatedCandidates.push(p);
            }
          }
        }
        if (relatedCandidates.length > 0) {
          const relatedSlice = relatedCandidates.slice(0, normalizedLimit);
          logInfo('HubSpot related fallback', { query: trimmed, productType: contentTerms[0], count: relatedSlice.length });
          return {
            products: relatedSlice,
            matchType: 'related',
            reason: relatedConfig.reasonEn,
          };
        }
      }
    }

    logInfo('HubSpot product search: no results', { query });
    return emptyExact;
  } catch (err) {
    logError('HubSpot product search failed', err);
    return emptyExact;
  }
}

export async function getHubSpotProduct(productId: string): Promise<WooProduct | null> {
  const token = getProductToken();
  if (!token) return null;

  try {
    const descriptionProps = await getDescriptionPropertyNames();
    const allProps = [...new Set([...PRODUCT_PROPERTIES, ...descriptionProps.short, ...descriptionProps.detailed])].join(',');
    const raw = await hubspotRequest<HubSpotProductRecord>(
      `/crm/v3/objects/products/${encodeURIComponent(productId)}?properties=${encodeURIComponent(allProps)}`
    );
    return mapHubSpotToWooProduct(raw, descriptionProps);
  } catch {
    // Not always HubSpot object ID. Try lookup by Woo ID/SKU mapping properties.
  }

  try {
    const [propertyNames, descriptionProps] = await Promise.all([
      getProductPropertyNames(),
      getDescriptionPropertyNames()
    ]);
    const candidateProps = [
      'store_product_id',
      'woo_product_id',
      'wc_product_id',
      'woocommerce_id',
      'external_product_id',
      'hs_sku',
      'sku',
      'barcode',
      'ean',
      'ean13',
      'upc',
      'gtin'
    ].filter((name) => propertyNames.has(name));

    if (candidateProps.length === 0) return null;

    const response = await hubspotRequest<{ results?: HubSpotProductRecord[] }>(
      '/crm/v3/objects/products/search',
      {
        method: 'POST',
        body: JSON.stringify({
          filterGroups: candidateProps.map((propertyName) => ({
            filters: [{ propertyName, operator: 'EQ', value: productId }]
          })),
          limit: 1,
          properties: [...new Set([...PRODUCT_PROPERTIES, ...descriptionProps.short, ...descriptionProps.detailed])]
        })
      }
    );

    const first = response.results?.[0];
    return first ? mapHubSpotToWooProduct(first, descriptionProps) : null;
  } catch (err) {
    logError('HubSpot product lookup failed', { productId, err });
    return null;
  }
}
