/**
 * WooCommerce REST API adapter.
 * Use when INTEGRATION_MODE_WOO=rest. Requires Woo REST credentials in env.
 */

import type { WooCommerceAdapter, WooProduct, WooVariation, SearchProductsMeta } from './types';
import {
  getHubSpotProduct,
  searchHubSpotProducts
} from '../hubspot/productCatalog';
import { logError, logInfo } from '../../logger';

function getWooBaseUrl(): string {
  const base = process.env.WOO_BASE_URL;
  if (!base) throw new Error('WOO_BASE_URL is not set for REST adapter');
  return base.replace(/\/$/, '');
}

function hasWooRestConfigured(): boolean {
  return !!(process.env.WOO_BASE_URL && process.env.WOO_CONSUMER_KEY && process.env.WOO_CONSUMER_SECRET);
}

type ProductSource = 'woo' | 'hubspot';

function getProductSource(): ProductSource {
  const raw = (process.env.INTEGRATION_PRODUCT_SOURCE ?? process.env.PRODUCT_SOURCE ?? '').trim().toLowerCase();
  if (raw === 'woo' || raw === 'woocommerce') return 'woo';
  if (raw === 'hubspot') return 'hubspot';
  return process.env.HUBSPOT_PRODUCTS_ACCESS_TOKEN || process.env.HUBSPOT_ACCESS_TOKEN ? 'hubspot' : 'woo';
}

function overlapCount(a: string[] = [], b: string[] = []): number {
  const setA = new Set(a.map((x) => x.toLowerCase()));
  let count = 0;
  for (const item of b) {
    if (setA.has(item.toLowerCase())) count += 1;
  }
  return count;
}

/** Normalize manufacturer for search and comparison (trim, remove leading dots). */
function normalizeManufacturer(s: string | undefined | null): string {
  if (s == null) return '';
  return String(s).trim().replace(/^\.+/, '').trim();
}

function getAuthHeader(): string {
  const key = process.env.WOO_CONSUMER_KEY;
  const secret = process.env.WOO_CONSUMER_SECRET;
  if (!key || !secret) throw new Error('WOO_CONSUMER_KEY and WOO_CONSUMER_SECRET required for REST');
  const encoded = Buffer.from(`${key}:${secret}`).toString('base64');
  return `Basic ${encoded}`;
}

function stripHtml(html: string | undefined | null): string {
  if (!html) return '';
  return html.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, "'").trim();
}

function readMeta(raw: any, keys: string[]): unknown {
  const keySet = new Set(keys.map((k) => k.toLowerCase()));
  const meta = Array.isArray(raw?.meta_data) ? raw.meta_data : [];
  for (const entry of meta) {
    const key = String(entry?.key ?? '').toLowerCase();
    if (keySet.has(key)) return entry?.value;
  }
  for (const key of keys) {
    if (raw?.[key] !== undefined && raw?.[key] !== null && raw?.[key] !== '') return raw[key];
  }
  return undefined;
}

function toPositiveInt(value: unknown): number | undefined {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return undefined;
  return Math.floor(num);
}

function normalizeProduct(raw: any): WooProduct {
  const manufacturerRaw =
    readMeta(raw, ['manufacturer', 'manufacturer_name', 'supplier', 'vendor', 'brand']) ??
    raw?.brands?.[0]?.name;
  const boxesPerLayerRaw = readMeta(raw, [
    'boxes_per_layer',
    'box_per_layer',
    'cartons_per_layer',
    'units_per_layer'
  ]);
  const unitsPerBoxRaw = readMeta(raw, [
    'units_per_box',
    'units_in_box',
    'units_per_carton',
    'qty_per_box'
  ]);
  const layersPerSurfaceRaw = readMeta(raw, [
    'layers_per_surface',
    'number_of_layers_per_surface',
    'layers_per_pallet',
    'pallet_layers'
  ]);
  const boxesPerSurfaceRaw = readMeta(raw, [
    'boxes_per_surface',
    'boxes_per_pallet',
    'cartons_per_surface',
    'cartons_per_pallet'
  ]);
  const barcodeRaw = readMeta(raw, ['barcode', 'ean', 'ean13', 'upc', 'gtin']);
  const costPriceRaw = readMeta(raw, ['cost_price', 'cost']);
  const importPricePerSurfaceRaw = readMeta(raw, ['import_price_per_surface', 'import_price_surface']);
  const importPricePer2BoxesRaw = readMeta(raw, ['import_price_per_2_boxes', 'import_price_2boxes']);
  const wholesalePriceRaw = readMeta(raw, ['wholesale_price', 'stock_price']);
  const salePriceRaw = raw?.sale_price || readMeta(raw, ['sale_price', 'on_sale_price']);
  const statusRaw = raw?.status ?? readMeta(raw, ['status']);
  const isDownloadableRaw = raw?.downloadable ?? readMeta(raw, ['is_downloadable', 'downloadable']);
  const downloadLinkRaw = readMeta(raw, ['download_link', 'download_url']);
  const subCategoryRaw = readMeta(raw, ['sub_category', 'subcategory']);
  const tagsRaw = Array.isArray(raw?.tags) ? raw.tags.map((t: any) => t.name ?? String(t)) : undefined;
  const inventoryRaw = raw?.stock_quantity ?? readMeta(raw, ['inventory', 'stock_quantity']);

  return {
    id: String(raw?.id ?? ''),
    name: String(raw?.name ?? ''),
    price: raw?.price != null ? String(raw.price) : undefined,
    permalink: raw?.permalink,
    description: stripHtml(raw?.description),
    shortDescription: stripHtml(raw?.short_description),
    detailedDescription: stripHtml(raw?.description) ?? stripHtml(raw?.short_description),
    images: Array.isArray(raw?.images)
      ? raw.images.map((img: any) => ({ src: img.src, alt: img.alt }))
      : [],
    categories: Array.isArray(raw?.categories)
      ? raw.categories.map((c: any) => ({ id: c.id, name: c.name }))
      : [],
    subCategory: subCategoryRaw != null ? String(subCategoryRaw) : undefined,
    type: raw?.type ?? 'simple',
    inStock: raw?.in_stock ?? raw?.stock_status === 'instock',
    inventory: typeof inventoryRaw === 'number' ? inventoryRaw : (typeof inventoryRaw === 'string' ? parseInt(inventoryRaw, 10) || undefined : undefined),
    relatedIds: Array.isArray(raw?.related_ids) ? raw.related_ids : [],
    crossSellIds: Array.isArray(raw?.cross_sell_ids) ? raw.cross_sell_ids : [],
    upsellIds: Array.isArray(raw?.upsell_ids) ? raw.upsell_ids : [],
    purchasable: raw?.purchasable ?? true,
    weight: raw?.weight != null ? String(raw.weight) : undefined,
    barcode: barcodeRaw != null ? String(barcodeRaw) : undefined,
    costPrice: costPriceRaw != null ? String(costPriceRaw) : undefined,
    importPricePerSurface: importPricePerSurfaceRaw != null ? String(importPricePerSurfaceRaw) : undefined,
    importPricePer2Boxes: importPricePer2BoxesRaw != null ? String(importPricePer2BoxesRaw) : undefined,
    wholesalePrice: wholesalePriceRaw != null ? String(wholesalePriceRaw) : undefined,
    retailPrice: raw?.price != null ? String(raw.price) : undefined,
    salePrice: salePriceRaw != null && String(salePriceRaw).trim() !== '' ? String(salePriceRaw) : undefined,
    status: statusRaw != null ? String(statusRaw) : undefined,
    isDownloadable: isDownloadableRaw === true || isDownloadableRaw === 'true' || isDownloadableRaw === '1',
    downloadLink: downloadLinkRaw != null ? String(downloadLinkRaw) : undefined,
    manufacturer: manufacturerRaw != null ? String(manufacturerRaw) : undefined,
    tags: tagsRaw,
    unitsPerBox: toPositiveInt(unitsPerBoxRaw),
    layersPerSurface: toPositiveInt(layersPerSurfaceRaw),
    boxesPerSurface: toPositiveInt(boxesPerSurfaceRaw),
    boxesPerLayer: toPositiveInt(boxesPerLayerRaw),
    metadata: {
      inventory: typeof inventoryRaw === 'number' ? inventoryRaw : undefined,
      weight: raw?.weight != null ? String(raw.weight) : undefined,
      barcode: barcodeRaw != null ? String(barcodeRaw) : undefined,
      costPrice: costPriceRaw != null ? String(costPriceRaw) : undefined,
      importPricePerSurface: importPricePerSurfaceRaw != null ? String(importPricePerSurfaceRaw) : undefined,
      importPricePer2Boxes: importPricePer2BoxesRaw != null ? String(importPricePer2BoxesRaw) : undefined,
      wholesalePrice: wholesalePriceRaw != null ? String(wholesalePriceRaw) : undefined,
      salePrice: salePriceRaw != null ? String(salePriceRaw) : undefined,
      unitsPerBox: toPositiveInt(unitsPerBoxRaw),
      layersPerSurface: toPositiveInt(layersPerSurfaceRaw),
      boxesPerSurface: toPositiveInt(boxesPerSurfaceRaw),
      manufacturer: manufacturerRaw != null ? String(manufacturerRaw) : undefined,
      boxesPerLayer: toPositiveInt(boxesPerLayerRaw)
    }
  };
}

function normalizeVariation(raw: any): WooVariation {
  return {
    id: String(raw?.id ?? ''),
    price: raw?.price != null ? String(raw.price) : undefined,
    attributes: Array.isArray(raw?.attributes)
      ? raw.attributes.map((a: any) => ({ name: a.name, option: a.option }))
      : [],
    inStock: raw?.in_stock ?? raw?.stock_status === 'instock'
  };
}

async function wooFetch<T>(path: string, params?: Record<string, string>): Promise<T> {
  const base = getWooBaseUrl();
  const auth = getAuthHeader();
  const url = new URL(`${base}/wp-json/wc/v3${path}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }
  const res = await fetch(url.toString(), {
    headers: { Authorization: auth, 'Content-Type': 'application/json' }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Woo REST ${res.status} ${text}`);
  }
  return res.json() as Promise<T>;
}

export function createRestWooAdapter(): WooCommerceAdapter {
  // Simple TTL cache: key → { data, expiry }
  const cache = new Map<string, { data: any; expiry: number }>();
  const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const entry = cache.get(key);
    if (entry && Date.now() < entry.expiry) return Promise.resolve(entry.data as T);
    return fn().then((data) => {
      cache.set(key, { data, expiry: Date.now() + CACHE_TTL });
      return data;
    });
  }

  function productPriceNum(p: WooProduct): number {
    const raw = p.price ?? p.retailPrice ?? p.salePrice ?? '';
    const n = parseFloat(String(raw).replace(/,/g, ''));
    return Number.isFinite(n) ? n : 0;
  }

  function applyPriceFilter(products: WooProduct[], maxPrice?: number, minPrice?: number): WooProduct[] {
    if (maxPrice == null && minPrice == null) return products;
    return products.filter((p) => {
      const price = productPriceNum(p);
      if (maxPrice != null && price > maxPrice) return false;
      if (minPrice != null && price < minPrice) return false;
      return true;
    });
  }

  return {
    async searchProducts(query: string, filters?: { category?: string; limit?: number; maxPrice?: number; minPrice?: number }): Promise<WooProduct[]> {
      const cacheKey = `search:${query}:${filters?.category ?? ''}:${filters?.limit ?? 200}:${filters?.maxPrice ?? ''}:${filters?.minPrice ?? ''}`;
      return cached(cacheKey, async () => {
        const source = getProductSource();
        const limit = filters?.limit ?? 200;
        if (source === 'hubspot') {
          const result = await searchHubSpotProducts(query, limit);
          const hubspotProducts = result.products;
          logInfo(`HubSpot product search: fetched ${hubspotProducts.length} products`, { query, limit });
          const strictHubSpotOnly = hubspotProducts.filter((p) => p.metadata?.source === 'hubspot');
          if (strictHubSpotOnly.length !== hubspotProducts.length) {
            logInfo(`Filtered out ${hubspotProducts.length - strictHubSpotOnly.length} non-HubSpot products`, {
              total: hubspotProducts.length,
              hubspotOnly: strictHubSpotOnly.length
            });
          }
          let byCategory = filters?.category
            ? strictHubSpotOnly.filter((p) =>
                (p.categories ?? []).some(
                  (c) =>
                    c.name.toLowerCase() === filters.category!.toLowerCase() ||
                    String(c.id) === filters.category
                )
              )
            : strictHubSpotOnly;
          byCategory = applyPriceFilter(byCategory, filters?.maxPrice, filters?.minPrice);
          logInfo(`Returning ${byCategory.length} HubSpot products after filtering`, { query, limit });
          return byCategory.slice(0, limit);
        }

        // WooCommerce source path
        logInfo(`WooCommerce product search`, { query, limit });
        try {
          if (!hasWooRestConfigured()) return [];
          const params: Record<string, string> = {
            per_page: String(limit)
          };
          if (query) params.search = query;
          if (filters?.category) params.category = filters.category;

          const data = await wooFetch<any[]>('/products', params);
          let products = (Array.isArray(data) ? data : []).map(normalizeProduct);
          products = applyPriceFilter(products, filters?.maxPrice, filters?.minPrice);
          logInfo(`Returning ${products.length} WooCommerce products`, { query, limit });
          return products.slice(0, limit);
        } catch (err) {
          logError('Woo REST searchProducts failed', err);
          return [];
        }
      });
    },

    async searchProductsWithMeta(query: string, filters?: { category?: string; limit?: number; maxPrice?: number; minPrice?: number }): Promise<SearchProductsMeta> {
      const source = getProductSource();
      const limit = filters?.limit ?? 200;
      if (source === 'hubspot') {
        const result = await searchHubSpotProducts(query, limit);
        let strictHubSpotOnly = result.products.filter((p) => p.metadata?.source === 'hubspot');
        strictHubSpotOnly = applyPriceFilter(strictHubSpotOnly, filters?.maxPrice, filters?.minPrice);
        const byCategory = filters?.category
          ? strictHubSpotOnly.filter((p) =>
              (p.categories ?? []).some(
                (c) =>
                  c.name.toLowerCase() === filters.category!.toLowerCase() ||
                  String(c.id) === filters.category
              )
            )
          : strictHubSpotOnly;
        return {
          products: byCategory.slice(0, limit),
          matchType: result.matchType,
          reason: result.reason,
        };
      }
      const products = await this.searchProducts(query, filters);
      return { products, matchType: 'exact' };
    },

    async getProduct(productId: string): Promise<WooProduct | null> {
      return cached(`product:${productId}`, async () => {
        const source = getProductSource();
        if (source === 'hubspot') {
          return getHubSpotProduct(productId);
        }
        if (!hasWooRestConfigured()) return null;

        try {
          const data = await wooFetch<any>(`/products/${productId}`);
          return normalizeProduct(data);
        } catch (err: any) {
          if (err?.message?.includes('404')) return null;
          logError('Woo REST getProduct failed', err);
          throw err;
        }
      });
    },

    async getProductVariations(productId: string): Promise<WooVariation[]> {
      try {
        if (getProductSource() === 'hubspot') return [];
        if (!hasWooRestConfigured()) return [];
        const product = await this.getProduct(productId);
        const wooProductId =
          (product?.metadata?.wooProductId as string | undefined) ??
          (product?.metadata?.source === 'hubspot' ? undefined : product?.id) ??
          productId;
        const data = await wooFetch<any[]>(`/products/${wooProductId}/variations`, { per_page: '50' });
        return (Array.isArray(data) ? data : []).map(normalizeVariation);
      } catch (err) {
        logError('Woo REST getProductVariations failed', err);
        return [];
      }
    },

    async getRelatedProducts(productId: string, options?: { sameManufacturerOnly?: boolean }): Promise<WooProduct[]> {
      const cacheKey = `related:${productId}:${options?.sameManufacturerOnly ?? false}`;
      return cached(cacheKey, async () => {
        try {
          const source = getProductSource();
          const product = await this.getProduct(productId);
          if (!product) return [];

          if (source === 'hubspot') {
            // STRICT: Only use HubSpot products for related/cross-sell
            const mfrNormalized = normalizeManufacturer(product.manufacturer);
            const queries = [
              product.categories?.[0]?.name ?? '',
              mfrNormalized,
              ''
            ].filter((q, idx, arr) => q.length > 0 || idx === arr.length - 1);

            const pool: WooProduct[] = [];
            const seen = new Set<string>();
            for (const q of queries) {
              const { products: batch } = await searchHubSpotProducts(q, 24);
              for (const p of batch) {
                if (!p?.id) continue;
                if (seen.has(p.id)) continue;
                // STRICT: Only include products from HubSpot source
                if (p.metadata?.source !== 'hubspot') continue;
                seen.add(p.id);
                pool.push(p);
              }
            }

            const currentHubSpotId = String(product.metadata?.hubspotProductId ?? '');
            const currentCats = (product.categories ?? []).map((c) => c.name);
            const productMfrNorm = normalizeManufacturer(product.manufacturer);
            const ranked = pool
              .filter((p) => {
                if (p.id === product.id) return false;
                const pHubspotId = String(p.metadata?.hubspotProductId ?? '');
                if (currentHubSpotId && pHubspotId && pHubspotId === currentHubSpotId) return false;
                return true;
              })
              .map((p) => {
                const pCats = (p.categories ?? []).map((c) => c.name);
                const pMfrNorm = normalizeManufacturer(p.manufacturer);
                const sameManufacturer =
                  productMfrNorm.length > 0 &&
                  pMfrNorm.length > 0 &&
                  productMfrNorm.toLowerCase() === pMfrNorm.toLowerCase();
                const categoryOverlap = overlapCount(currentCats, pCats);
                const score = (sameManufacturer ? 3 : 0) + categoryOverlap;
                return { p, score, sameManufacturer };
              })
              .sort((a, b) => b.score - a.score)
              .map((entry) => entry.p);

            // When sameManufacturerOnly: return only products from the same manufacturer (so import/group add won't fail)
            const sameManufacturerOnly = (options?.sameManufacturerOnly === true);
            const filtered = sameManufacturerOnly && productMfrNorm.length > 0
              ? ranked.filter((p) => {
                  const pMfr = normalizeManufacturer(p.manufacturer);
                  return pMfr.length > 0 && pMfr.toLowerCase() === productMfrNorm.toLowerCase();
                })
              : ranked;

            return filtered.slice(0, 4);
          }

          // WooCommerce source path
          if (!hasWooRestConfigured()) return [];
          const wooProductId = (product.metadata?.wooProductId as string | undefined) ?? productId;

          const relatedIds = [
            ...(product.crossSellIds ?? []),
            ...(product.upsellIds ?? []),
            ...(product.relatedIds ?? [])
          ].slice(0, 4);

          if (relatedIds.length > 0) {
            const data = await wooFetch<any[]>('/products', {
              include: relatedIds.join(','),
              per_page: String(relatedIds.length)
            });
            return (Array.isArray(data) ? data : []).map(normalizeProduct);
          }

          // Fallback 1: same category
          if (product.categories && product.categories.length > 0) {
            const catId = product.categories[0].id;
            const data = await wooFetch<any[]>('/products', {
              category: String(catId),
              per_page: '5',
              exclude: wooProductId
            });
            const results = (Array.isArray(data) ? data : [])
              .map(normalizeProduct)
              .filter((p) => p.id !== wooProductId)
              .slice(0, 4);
            if (results.length > 0) return results;
          }

          // Fallback 2: return any other products from the catalog
          const data = await wooFetch<any[]>('/products', {
            per_page: '6',
            exclude: wooProductId
          });
          return (Array.isArray(data) ? data : [])
            .map(normalizeProduct)
            .filter((p) => p.id !== wooProductId)
            .slice(0, 4);
        } catch (err) {
          logError('Woo REST getRelatedProducts failed', err);
          return [];
        }
      });
    }
  };
}
