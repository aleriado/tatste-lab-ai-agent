/**
 * WooCommerce adapter via WordPress/Woo MCP.
 * Requires MCP_WP_BASE_URL. If exact MCP endpoint paths are unknown, placeholders return a clear error;
 * mock fallback is used when MCP is not configured or fails.
 */

import { mcpGet, mcpPost } from '../mcpClient';
import type { WooCommerceAdapter, WooProduct } from './types';
import { logInfo, logError } from '../../logger';

function normalizeProduct(raw: any): WooProduct {
  return {
    id: String(raw?.id ?? raw?.product_id ?? ''),
    name: String(raw?.name ?? raw?.title ?? ''),
    price: raw?.price != null ? String(raw.price) : undefined,
    permalink: raw?.permalink ?? raw?.link,
    description: raw?.description
  };
}

export function createMcpWooAdapter(): WooCommerceAdapter {
  return {
    async searchProducts(query: string): Promise<WooProduct[]> {
      try {
        // TODO: Replace with actual MCP endpoint path when known (e.g. /wp/v2/products?search=... or MCP tool)
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
        // TODO: Replace with actual MCP endpoint path when known
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
    }
  };
}
