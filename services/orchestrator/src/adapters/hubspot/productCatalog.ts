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

const PRODUCT_PROPERTIES = [
  'name',
  'description',
  'short_description',
  'detailed_description',
  'full_description',
  'long_description',
  'hs_sku',
  'sku',
  'woo_product_id',
  'wc_product_id',
  'woocommerce_id',
  'external_product_id',
  'store_product_id',
  'price',
  'hs_price',
  'manufacturer_id',
  'manufacturer_name',
  'yzrn__spq_producer__supplier',
  'brand',
  'brand_id',
  'mwtg_brand',
  'units_per_box',
  'units_in_box',
  'units_per_carton',
  'mspr_yhydwt_bqrtwn',
  'boxes_per_layer',
  'box_per_layer',
  'cartons_per_layer',
  'units_per_layer',
  'mspr_qrtwnym_bskbh',
  'layers_per_surface',
  'number_of_layers_per_surface',
  'layers_per_pallet',
  'mspr_qrtwnym_bmsth',
  'boxes_per_surface',
  'boxes_per_pallet',
  'cartons_per_surface',
  'weight',
  'barcode',
  'ean',
  'ean13',
  'upc',
  'gtin',
  'hs_product_type',
  'product_type',
  'type_label',
  'image_url',
  'product_image_url',
  'url',
  'product_url',
  'category',
  'categories',
  'in_stock',
  'stock_status'
];

function mapHubSpotToWooProduct(
  raw: HubSpotProductRecord,
  descriptionProps?: { short: string[]; detailed: string[] }
): WooProduct {
  const p = raw.properties ?? {};
  const wooProductId = firstNonEmpty([
    p.store_product_id,
    p.woo_product_id,
    p.wc_product_id,
    p.woocommerce_id,
    p.external_product_id
  ]);
  const sku = firstNonEmpty([p.hs_sku, p.sku]);
  const productId = firstNonEmpty([wooProductId, sku, raw.id]) as string;

  const manufacturerId = firstNonEmpty([p.manufacturer_id, p.brand_id]);
  const manufacturerName = firstNonEmpty([
    p.manufacturer_name,
    p.yzrn__spq_producer__supplier,
    p.brand,
    p.mwtg_brand
  ]);
  const unitsPerBox = toPositiveInt(
    firstNonEmpty([p.units_per_box, p.units_in_box, p.units_per_carton, p.mspr_yhydwt_bqrtwn])
  );
  const boxesPerLayer = toPositiveInt(
    firstNonEmpty([
      p.boxes_per_layer,
      p.box_per_layer,
      p.cartons_per_layer,
      p.units_per_layer,
      p.mspr_qrtwnym_bskbh
    ])
  );
  const layersPerSurface = toPositiveInt(
    firstNonEmpty([
      p.layers_per_surface,
      p.number_of_layers_per_surface,
      p.layers_per_pallet,
      p.mspr_qrtwnym_bmsth
    ])
  );
  let boxesPerSurface = toPositiveInt(
    firstNonEmpty([p.boxes_per_surface, p.boxes_per_pallet, p.cartons_per_surface])
  );
  if (!boxesPerSurface && boxesPerLayer && layersPerSurface) {
    boxesPerSurface = boxesPerLayer * layersPerSurface;
  }
  const barcode = firstNonEmpty([p.barcode, p.ean, p.ean13, p.upc, p.gtin]);
  const productType = firstNonEmpty([p.product_type, p.type_label, p.hs_product_type]);

  const imageUrl = firstNonEmpty([p.image_url, p.product_image_url]);
  const permalink = firstNonEmpty([p.url, p.product_url]);

  let shortDescription: string | undefined;
  let detailedDescription: string | undefined;
  if (descriptionProps) {
    shortDescription = getFirstFromProps(p, descriptionProps.short);
    detailedDescription = getFirstFromProps(p, descriptionProps.detailed);
  }
  shortDescription ??= firstNonEmpty([p.short_description]);
  detailedDescription ??= firstNonEmpty([
    p.detailed_description,
    p.full_description,
    p.long_description,
    p.description
  ]);
  const description = firstNonEmpty([p.description]) ?? shortDescription ?? detailedDescription;

  const stockStatus = firstNonEmpty([p.stock_status])?.toLowerCase();
  const inStockRaw = firstNonEmpty([p.in_stock]);
  const inStock =
    inStockRaw != null
      ? ['1', 'true', 'yes', 'instock'].includes(inStockRaw.toLowerCase())
      : stockStatus
        ? stockStatus === 'instock' || stockStatus === 'in_stock'
        : undefined;

  return {
    id: productId,
    name: normalizeDisplayName(firstNonEmpty([p.name])) ?? `HubSpot Product ${raw.id}`,
    price: firstNonEmpty([p.hs_price, p.price]),
    permalink,
    description,
    shortDescription,
    detailedDescription,
    images: imageUrl ? [{ src: imageUrl }] : [],
    categories: parseCommaList(firstNonEmpty([p.categories, p.category])),
    type: 'simple',
    inStock,
    purchasable: true,
    weight: firstNonEmpty([p.weight]),
    barcode,
    productType,
    unitsPerBox,
    layersPerSurface,
    boxesPerSurface,
    manufacturerId,
    manufacturerName,
    boxesPerLayer,
    metadata: {
      source: 'hubspot',
      hubspotProductId: raw.id,
      wooProductId,
      sku,
      barcode,
      productType,
      unitsPerBox,
      layersPerSurface,
      boxesPerSurface,
      manufacturerId,
      manufacturerName,
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

export async function searchHubSpotProducts(query: string, limit: number): Promise<WooProduct[]> {
  const token = getProductToken();
  if (!token) return [];

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
    let results: HubSpotProductRecord[] = [];

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
            properties: allProps
          })
        });
        const pageItems = response.results ?? [];
        results.push(...pageItems);
        after = response.paging?.next?.after;
        if (!after || pageItems.length === 0) break;
      }
    }

    const mapped = results.map((r) => mapHubSpotToWooProduct(r, descriptionProps));
    logInfo('HubSpot product search success', {
      query,
      requestedLimit: desired,
      returned: mapped.length
    });
    return mapped;
  } catch (err) {
    logError('HubSpot product search failed', err);
    return [];
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
