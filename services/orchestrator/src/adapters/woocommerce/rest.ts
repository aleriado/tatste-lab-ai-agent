/**
 * Optional WooCommerce REST API adapter.
 * Use when INTEGRATION_MODE_WOO=rest. Requires Woo REST credentials in env.
 */

import type { WooCommerceAdapter, WooProduct } from './types';
import { logError } from '../../logger';

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

function normalizeProduct(raw: any): WooProduct {
  return {
    id: String(raw?.id ?? ''),
    name: String(raw?.name ?? ''),
    price: raw?.price != null ? String(raw.price) : undefined,
    permalink: raw?.permalink,
    description: raw?.description
  };
}

export function createRestWooAdapter(): WooCommerceAdapter {
  return {
    async searchProducts(query: string): Promise<WooProduct[]> {
      try {
        const base = getWooBaseUrl();
        const auth = getAuthHeader();
        const url = `${base}/wp-json/wc/v3/products?search=${encodeURIComponent(query)}`;
        const res = await fetch(url, {
          headers: { Authorization: auth, 'Content-Type': 'application/json' }
        });
        if (!res.ok) throw new Error(`Woo REST ${res.status} ${await res.text()}`);
        const data = await res.json();
        return (Array.isArray(data) ? data : []).map(normalizeProduct);
      } catch (err) {
        logError('Woo REST searchProducts failed', err);
        throw err;
      }
    },

    async getProduct(productId: string): Promise<WooProduct | null> {
      try {
        const base = getWooBaseUrl();
        const auth = getAuthHeader();
        const res = await fetch(`${base}/wp-json/wc/v3/products/${productId}`, {
          headers: { Authorization: auth, 'Content-Type': 'application/json' }
        });
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`Woo REST ${res.status} ${await res.text()}`);
        const data = await res.json();
        return normalizeProduct(data);
      } catch (err) {
        logError('Woo REST getProduct failed', err);
        throw err;
      }
    }
  };
}
