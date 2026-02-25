/**
 * WooCommerce adapter via WordPress/Woo MCP.
 * Requires MCP_WP_BASE_URL. If exact MCP endpoint paths are unknown, placeholders return a clear error;
 * mock fallback is used when MCP is not configured or fails.
 */

import { mcpGet } from '../mcpClient';
import type { WooCommerceAdapter, WooProduct, WooVariation } from './types';
import { logInfo, logError } from '../../logger';

function normalizeProduct(raw: any): WooProduct {
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
    relatedIds: Array.isArray(raw?.related_ids) ? raw.related_ids : [],
    crossSellIds: Array.isArray(raw?.cross_sell_ids) ? raw.cross_sell_ids : [],
    upsellIds: Array.isArray(raw?.upsell_ids) ? raw.upsell_ids : []
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
