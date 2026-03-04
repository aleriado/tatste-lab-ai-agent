/**
 * WooCommerce adapter via WordPress/Woo MCP.
 * Requires MCP_WP_BASE_URL. If exact MCP endpoint paths are unknown, placeholders return a clear error;
 * mock fallback is used when MCP is not configured or fails.
 */

import { mcpGet } from '../mcpClient';
import type { WooCommerceAdapter, WooProduct, WooVariation } from './types';
import { logInfo, logError } from '../../logger';

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
  const productTypeRaw = readMeta(raw, ['product_type', 'type_label']);

  return {
    id: String(raw?.id ?? raw?.product_id ?? ''),
    name: String(raw?.name ?? raw?.title ?? ''),
    price: raw?.price != null ? String(raw.price) : undefined,
    permalink: raw?.permalink ?? raw?.link,
    description: raw?.description,
    shortDescription: raw?.short_description,
    images: Array.isArray(raw?.images)
      ? raw.images.map((img: any) => ({ src: img.src, alt: img.alt }))
      : [],
    categories: Array.isArray(raw?.categories)
      ? raw.categories.map((c: any) => ({ id: c.id, name: c.name }))
      : [],
    type: raw?.type ?? 'simple',
    inStock: raw?.in_stock ?? raw?.stock_status === 'instock',
    stockQuantity: typeof raw?.stock_quantity === 'number' ? raw.stock_quantity : undefined,
    relatedIds: Array.isArray(raw?.related_ids) ? raw.related_ids : [],
    crossSellIds: Array.isArray(raw?.cross_sell_ids) ? raw.cross_sell_ids : [],
    upsellIds: Array.isArray(raw?.upsell_ids) ? raw.upsell_ids : [],
    weight: raw?.weight != null ? String(raw.weight) : undefined,
    barcode: barcodeRaw != null ? String(barcodeRaw) : undefined,
    productType: productTypeRaw != null ? String(productTypeRaw) : undefined,
    unitsPerBox: toPositiveInt(unitsPerBoxRaw),
    layersPerSurface: toPositiveInt(layersPerSurfaceRaw),
    boxesPerSurface: toPositiveInt(boxesPerSurfaceRaw),
    manufacturerId: manufacturerIdRaw != null ? String(manufacturerIdRaw) : undefined,
    manufacturerName: manufacturerNameRaw != null ? String(manufacturerNameRaw) : undefined,
    boxesPerLayer: toPositiveInt(boxesPerLayerRaw),
    metadata: {
      stockQuantity: typeof raw?.stock_quantity === 'number' ? raw.stock_quantity : undefined,
      weight: raw?.weight != null ? String(raw.weight) : undefined,
      barcode: barcodeRaw != null ? String(barcodeRaw) : undefined,
      productType: productTypeRaw != null ? String(productTypeRaw) : undefined,
      unitsPerBox: toPositiveInt(unitsPerBoxRaw),
      layersPerSurface: toPositiveInt(layersPerSurfaceRaw),
      boxesPerSurface: toPositiveInt(boxesPerSurfaceRaw),
      manufacturerId: manufacturerIdRaw != null ? String(manufacturerIdRaw) : undefined,
      manufacturerName: manufacturerNameRaw != null ? String(manufacturerNameRaw) : undefined,
      boxesPerLayer: toPositiveInt(boxesPerLayerRaw)
    }
  };
}

export function createMcpWooAdapter(): WooCommerceAdapter {
  return {
    async searchProducts(query: string): Promise<WooProduct[]> {
      try {
        const path = process.env.MCP_WP_PRODUCTS_SEARCH_PATH ?? '/wp-json/wc/v3/products';
        const params: Record<string, string> = { search: query };
        const data = await mcpGet<any>(path, params);
        if (Array.isArray(data)) {
          return data.map(normalizeProduct).filter((p: WooProduct) => p.id);
        }
        if (data?.products && Array.isArray(data.products)) {
          return data.products.map(normalizeProduct).filter((p: WooProduct) => p.id);
        }
        logInfo('MCP Woo searchProducts: unexpected response shape', { data });
        return [];
      } catch (err) {
        logError('MCP Woo searchProducts failed', err);
        throw new Error(
          'WooCommerce MCP search is not configured or failed. Set MCP_WP_BASE_URL and correct MCP endpoint, or use INTEGRATION_MODE_WOO=mock.'
        );
      }
    },

    async getProduct(productId: string): Promise<WooProduct | null> {
      try {
        const path =
          process.env.MCP_WP_PRODUCT_PATH ?? `/wp-json/wc/v3/products/${productId}`;
        const data = await mcpGet<any>(path);
        if (data && (data.id || data.product_id)) {
          return normalizeProduct(data);
        }
        return null;
      } catch (err) {
        logError('MCP Woo getProduct failed', err);
        throw new Error(
          'WooCommerce MCP getProduct is not configured or failed. Use INTEGRATION_MODE_WOO=mock for demo.'
        );
      }
    },

    async getProductVariations(productId: string): Promise<WooVariation[]> {
      try {
        const path = `/wp-json/wc/v3/products/${productId}/variations`;
        const data = await mcpGet<any[]>(path);
        if (Array.isArray(data)) {
          return data.map((v) => ({
            id: String(v.id ?? ''),
            price: v.price != null ? String(v.price) : undefined,
            attributes: Array.isArray(v.attributes)
              ? v.attributes.map((a: any) => ({ name: a.name, option: a.option }))
              : [],
            inStock: v.in_stock ?? v.stock_status === 'instock'
          }));
        }
        return [];
      } catch (err) {
        logError('MCP Woo getProductVariations failed', err);
        return [];
      }
    },

    async getRelatedProducts(productId: string): Promise<WooProduct[]> {
      try {
        const product = await this.getProduct(productId);
        if (!product) return [];
        const ids = [
          ...(product.crossSellIds ?? []),
          ...(product.upsellIds ?? []),
          ...(product.relatedIds ?? [])
        ].slice(0, 4);
        if (ids.length === 0) return [];
        const data = await mcpGet<any[]>('/wp-json/wc/v3/products', {
          include: ids.join(','),
          per_page: String(ids.length)
        });
        return (Array.isArray(data) ? data : []).map(normalizeProduct);
      } catch (err) {
        logError('MCP Woo getRelatedProducts failed', err);
        return [];
      }
    }
  };
}
