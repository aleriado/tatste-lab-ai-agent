/**
 * WooCommerce REST API adapter.
 * Use when INTEGRATION_MODE_WOO=rest. Requires Woo REST credentials in env.
 */

import type { WooCommerceAdapter, WooProduct, WooVariation } from './types';
import { logError, logInfo } from '../../logger';

function getWooBaseUrl(): string {
  const base = process.env.WOO_BASE_URL;
  if (!base) throw new Error('WOO_BASE_URL is not set for REST adapter');
  return base.replace(/\/$/, '');
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
  const manufacturerIdRaw =
    readMeta(raw, ['manufacturer_id', 'manufacturerId', 'supplier_id', 'vendor_id', 'brand_id']) ??
    raw?.brands?.[0]?.id;
  const manufacturerNameRaw =
    readMeta(raw, ['manufacturer_name', 'manufacturer', 'supplier', 'vendor', 'brand']) ??
    raw?.brands?.[0]?.name;
  const boxesPerLayerRaw = readMeta(raw, [
    'boxes_per_layer',
    'box_per_layer',
    'cartons_per_layer',
    'units_per_layer'
  ]);

  return {
    id: String(raw?.id ?? ''),
    name: String(raw?.name ?? ''),
    price: raw?.price != null ? String(raw.price) : undefined,
    permalink: raw?.permalink,
    description: stripHtml(raw?.description),
    shortDescription: stripHtml(raw?.short_description),
    images: Array.isArray(raw?.images)
      ? raw.images.map((img: any) => ({ src: img.src, alt: img.alt }))
      : [],
    categories: Array.isArray(raw?.categories)
      ? raw.categories.map((c: any) => ({ id: c.id, name: c.name }))
      : [],
    type: raw?.type ?? 'simple',
    inStock: raw?.in_stock ?? raw?.stock_status === 'instock',
    relatedIds: Array.isArray(raw?.related_ids) ? raw.related_ids : [],
    crossSellIds: Array.isArray(raw?.cross_sell_ids) ? raw.cross_sell_ids : [],
    upsellIds: Array.isArray(raw?.upsell_ids) ? raw.upsell_ids : [],
    purchasable: raw?.purchasable ?? true,
    manufacturerId: manufacturerIdRaw != null ? String(manufacturerIdRaw) : undefined,
    manufacturerName: manufacturerNameRaw != null ? String(manufacturerNameRaw) : undefined,
    boxesPerLayer: toPositiveInt(boxesPerLayerRaw),
    metadata: {
      manufacturerId: manufacturerIdRaw != null ? String(manufacturerIdRaw) : undefined,
      manufacturerName: manufacturerNameRaw != null ? String(manufacturerNameRaw) : undefined,
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

  return {
    async searchProducts(query: string, filters?: { category?: string; limit?: number }): Promise<WooProduct[]> {
      const cacheKey = `search:${query}:${filters?.category ?? ''}:${filters?.limit ?? 10}`;
      return cached(cacheKey, async () => {
        try {
          const params: Record<string, string> = {
            per_page: String(filters?.limit ?? 10)
          };
          if (query) params.search = query;
          if (filters?.category) params.category = filters.category;

          const data = await wooFetch<any[]>('/products', params);
          return (Array.isArray(data) ? data : []).map(normalizeProduct);
        } catch (err) {
          logError('Woo REST searchProducts failed', err);
          throw err;
        }
      });
    },

    async getProduct(productId: string): Promise<WooProduct | null> {
      return cached(`product:${productId}`, async () => {
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
        const data = await wooFetch<any[]>(`/products/${productId}/variations`, { per_page: '50' });
        return (Array.isArray(data) ? data : []).map(normalizeVariation);
      } catch (err) {
        logError('Woo REST getProductVariations failed', err);
        return [];
      }
    },

    async getRelatedProducts(productId: string): Promise<WooProduct[]> {
      return cached(`related:${productId}`, async () => {
        try {
          const product = await this.getProduct(productId);
          if (!product) return [];

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
              exclude: productId
            });
            const results = (Array.isArray(data) ? data : [])
              .map(normalizeProduct)
              .filter((p) => p.id !== productId)
              .slice(0, 4);
            if (results.length > 0) return results;
          }

          // Fallback 2: return any other products from the catalog
          const data = await wooFetch<any[]>('/products', {
            per_page: '6',
            exclude: productId
          });
          return (Array.isArray(data) ? data : [])
            .map(normalizeProduct)
            .filter((p) => p.id !== productId)
            .slice(0, 4);
        } catch (err) {
          logError('Woo REST getRelatedProducts failed', err);
          return [];
        }
      });
    }
  };
}
